// CLAUDE PROVIDER (profile kind "claude" in config/ai-providers.json, key in its keyEnv, normally
// ANTHROPIC_API_KEY). Steps build the prompt and validate the JSON; this file only sends the prompt,
// extracts the JSON and prices the call. The profile gives the model and thinking level per tier
// (mapped to Claude's `effort`), web search on or off, and the prices. Also reads LLM.maxTokens,
// LLM.maxResumes, LLM.retries, LLM.timeoutMs and the AI.research* web-search settings.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod/v4";
import type { AiProfile } from "../../config/ai-providers.ts";
import { AI, LLM } from "../../config/constants.ts";
import { ApiError } from "../../utils/response.ts";
import { extractJson } from "./json.ts";
import { priceUsd } from "./pricing.ts";
import type { CallUsage, Citation, CompletionRequest, CompletionResult, ModelTier, TextProvider } from "./types.ts";

type Message = Anthropic.Beta.BetaMessage;

/**
 * Tasks that do not use structured output. research: it runs web search, and a search answer is read as
 * text. activities: its `postings` is a free-key record, which the JSON schema conversion turns into
 * "always empty", so enforcing it would drop every posting. Both still go through extractJson.
 */
const FREE_FORM_TASKS = new Set(["research", "activities"]);

/**
 * The JSON schema Claude must answer in (structured output), or null for a free-form task or no schema.
 * With it, Claude can only produce valid JSON of the step's shape, so a stray quote or note cannot break it.
 */
export function structuredFormat(task: string, schema: ZodType | undefined): Anthropic.Beta.BetaJSONOutputFormat | null {
  if (!schema || FREE_FORM_TASKS.has(task)) return null;
  return { type: "json_schema", schema: zodOutputFormat(schema).schema };
}

/** Server-side fallback: on a policy decline the API re-runs the request on its default fallback model. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** The model's visible text blocks joined; thinking and tool blocks are skipped. */
const finalText = (message: Message) =>
  message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");

/**
 * The pages a turn's web search returned (web_search_tool_result blocks) and the ones its text cites, by URL,
 * first seen first. Read loosely (no SDK block types) so a new block shape is skipped rather than breaking a call.
 */
export function searchCitations(content: unknown[]): Citation[] {
  const found = new Map<string, Citation>();
  const add = (url: unknown, title: unknown) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url) && !found.has(url)) found.set(url, { url, title: typeof title === "string" ? title : "" });
  };
  for (const block of content as { type?: string; content?: unknown; citations?: unknown }[]) {
    if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content as { url?: unknown; title?: unknown }[]) add(r?.url, r?.title);
    }
    if (block?.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations as { url?: unknown; title?: unknown }[]) add(c?.url, c?.title);
    }
  }
  return [...found.values()];
}

/**
 * TextProvider backed by the Anthropic Messages API (beta endpoint, for server-side fallback and effort).
 * Created by registry.ts createAi for a profile of kind "claude".
 */
export class ClaudeTextProvider implements TextProvider {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(
    private readonly profile: AiProfile,
    apiKey: string,
  ) {
    this.name = profile.name;
    // The SDK retries 408/409/429/5xx and connection errors itself
    this.client = new Anthropic({ apiKey, maxRetries: LLM.retries, timeout: LLM.timeoutMs });
  }

  /**
   * One step's call. Only the research task gets the web_search tool (spec 5.2), limited to
   * AI.researchSearchDomains and AI.researchSearchMaxUses (or the request's searchMaxUses; 0 = no search).
   * The pages it retrieved come back as `citations`. Usage is summed across pause_turn resumes.
   * Throws AI_REFUSED or AI_OUTPUT_TRUNCATED on those stop reasons, and the codes from describeApiError.
   * Fixed-shape tasks use structured output (structuredFormat), so their JSON is always valid. Invalid or missing
   * JSON from a free-form task is not an error here: `json` is null and askModel retries, then fails the step.
   */
  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const model = this.profile.models[request.tier];
    const maxUses = request.searchMaxUses ?? AI.researchSearchMaxUses;
    const tools: Anthropic.Beta.BetaToolUnion[] =
      request.task === "research" && this.profile.webSearch && AI.researchWebSearch && maxUses > 0
        ? [{ type: "web_search_20260209", name: "web_search", max_uses: maxUses, allowed_domains: AI.researchSearchDomains }]
        : [];
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: request.prompt }];
    const format = structuredFormat(request.task, request.schema);
    const usage: Required<CallUsage> = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 };

    let message: Message | null = null;
    const citations: Citation[] = [];
    for (let turn = 0; turn <= LLM.maxResumes; turn++) {
      message = await this.send(model, request.tier, messages, tools, format);
      if (tools.length) citations.push(...searchCitations(message.content));
      // Summed over resumed turns: each pause_turn resend is billed again
      const u = message.usage;
      usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
      usage.inputTokens += u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      usage.outputTokens += u.output_tokens;
      usage.thinkingTokens += u.output_tokens_details?.thinking_tokens ?? 0;
      usage.webSearches += u.server_tool_use?.web_search_requests ?? 0;
      if (message.stop_reason !== "pause_turn") {
        break;
      }
      // A long web search paused the turn; send the partial answer back so the model continues
      messages.push({ role: "assistant", content: message.content });
    }
    // Still paused after LLM.maxResumes: the partial text is parsed as is and usually fails AI_OUTPUT_INVALID.
    // `message` is only null if LLM_MAX_RESUMES were negative, which constants.ts rejects; kept as a type guard.
    if (!message) {
      throw new ApiError(502, "AI_UNAVAILABLE", "The model returned no answer.");
    }
    if (message.stop_reason === "refusal") {
      throw new ApiError(502, "AI_REFUSED", "The model declined this request. Rephrase the brief or the feedback and try again.");
    }
    if (message.stop_reason === "max_tokens") {
      throw new ApiError(502, "AI_OUTPUT_TRUNCATED", "The model's answer was cut off. Try a smaller size or fewer competencies.");
    }
    const text = finalText(message);
    return {
      json: extractJson(text),
      text,
      model: message.model,
      usage,
      costUsd: priceUsd(this.profile.rates, request.tier, usage),
      estimated: this.profile.freeTier,
      ...(citations.length ? { citations } : {}),
    };
  }

  /** Streams (long answers would otherwise hit HTTP timeouts) and returns the finished message. */
  private async send(
    model: string,
    tier: ModelTier,
    messages: Anthropic.Beta.BetaMessageParam[],
    tools: Anthropic.Beta.BetaToolUnion[],
    format: Anthropic.Beta.BetaJSONOutputFormat | null,
  ) {
    try {
      return await this.request(model, tier, messages, tools, format);
    } catch (err) {
      throw describeApiError(err);
    }
  }

  /** The raw streaming call; `send` wraps it to translate SDK errors. */
  private request(
    model: string,
    tier: ModelTier,
    messages: Anthropic.Beta.BetaMessageParam[],
    tools: Anthropic.Beta.BetaToolUnion[],
    format: Anthropic.Beta.BetaJSONOutputFormat | null,
  ) {
    return this.client.beta.messages
      .stream({
        model,
        max_tokens: LLM.maxTokens,
        // Server-side fallback only where the model has one (the profile's serverFallback; Haiku 5.5 has none)
        ...(this.profile.serverFallback[tier] ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
        // Thinking is always on for these models; effort sets its depth. `format` enforces the step's JSON shape
        output_config: { effort: this.profile.thinking[tier], ...(format ? { format } : {}) },
        system: "Answer with one JSON object only, in the shape the prompt asks for. No prose before or after it.",
        messages,
        ...(tools.length ? { tools } : {}),
      })
      .finalMessage();
  }
}

/** SDK errors (after its own retries) as the coded errors the portal shows on the job. */
function describeApiError(err: unknown): unknown {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ApiError(502, "AI_AUTH", "The Claude API key was rejected. Check the key in .env or the secret store.");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ApiError(503, "AI_BUSY", "The model is busy (rate limit). Try again in a minute.");
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new ApiError(502, "AI_REQUEST_REJECTED", `The model rejected the request: ${err.message}`);
  }
  if (err instanceof Anthropic.APIError) {
    return new ApiError(502, "AI_UNAVAILABLE", "The model is unavailable right now. Try again shortly.");
  }
  return err;
}
