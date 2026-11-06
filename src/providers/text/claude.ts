// CLAUDE PROVIDER (profile kind "claude" in config/ai-providers.json, key in its keyEnv, normally
// ANTHROPIC_API_KEY). Steps build the prompt and validate the JSON; this file only sends the prompt,
// extracts the JSON and prices the call. The profile gives the model and thinking level per tier
// (mapped to Claude's `effort`), web search on or off, and the prices. Also reads LLM.maxTokens,
// LLM.maxResumes, LLM.retries, LLM.timeoutMs and the AI.research* web-search settings.
import Anthropic from "@anthropic-ai/sdk";
import type { AiProfile } from "../../config/ai-providers.ts";
import { AI, LLM } from "../../config/constants.ts";
import { ApiError } from "../../utils/response.ts";
import { extractJson } from "./json.ts";
import { priceUsd } from "./pricing.ts";
import type { CallUsage, CompletionRequest, CompletionResult, ModelTier, TextProvider } from "./types.ts";

type Message = Anthropic.Beta.BetaMessage;

/** Server-side fallback: on a policy decline the API re-runs the request on its default fallback model. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** The model's visible text blocks joined; thinking and tool blocks are skipped. */
const finalText = (message: Message) =>
  message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");

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
   * AI.researchSearchDomains and AI.researchSearchMaxUses. Usage is summed across pause_turn resumes.
   * Throws AI_REFUSED or AI_OUTPUT_TRUNCATED on those stop reasons, and the codes from describeApiError.
   * Invalid or missing JSON is not an error here: `json` is null and the step's schema check fails it.
   */
  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const model = this.profile.models[request.tier];
    const tools: Anthropic.Beta.BetaToolUnion[] =
      request.task === "research" && this.profile.webSearch && AI.researchWebSearch
        ? [{ type: "web_search_20260209", name: "web_search", max_uses: AI.researchSearchMaxUses, allowed_domains: AI.researchSearchDomains }]
        : [];
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: request.prompt }];
    const usage: Required<CallUsage> = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 };

    let message: Message | null = null;
    for (let turn = 0; turn <= LLM.maxResumes; turn++) {
      message = await this.send(model, request.tier, messages, tools);
      // Summed over resumed turns: each pause_turn resend is billed again
      const u = message.usage;
      usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
      usage.inputTokens += u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      usage.outputTokens += u.output_tokens;
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
    return { json: extractJson(finalText(message)), model: message.model, usage, costUsd: priceUsd(this.profile.rates, request.tier, usage), estimated: this.profile.freeTier };
  }

  /** Streams (long answers would otherwise hit HTTP timeouts) and returns the finished message. */
  private async send(model: string, tier: ModelTier, messages: Anthropic.Beta.BetaMessageParam[], tools: Anthropic.Beta.BetaToolUnion[]) {
    try {
      return await this.request(model, tier, messages, tools);
    } catch (err) {
      throw describeApiError(err);
    }
  }

  /** The raw streaming call; `send` wraps it to translate SDK errors. */
  private request(model: string, tier: ModelTier, messages: Anthropic.Beta.BetaMessageParam[], tools: Anthropic.Beta.BetaToolUnion[]) {
    return this.client.beta.messages
      .stream({
        model,
        max_tokens: LLM.maxTokens,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        // Thinking is always on for these models; effort sets its depth
        output_config: { effort: this.profile.thinking[tier] },
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
