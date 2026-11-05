// CLAUDE PROVIDER: the real model behind every AI step (spec 2, 9). Selected automatically when
// ANTHROPIC_API_KEY is set. Steps build the prompt and validate the JSON; this file only sends the
// prompt, extracts the JSON and prices the call.
import Anthropic from "@anthropic-ai/sdk";
import { AI, LLM, MODELS } from "../../config/constants.ts";
import { ApiError } from "../../utils/response.ts";
import { priceUsd } from "./pricing.ts";
import type { CallUsage, CompletionRequest, CompletionResult, ModelTier, TextProvider } from "./types.ts";

type Message = Anthropic.Beta.BetaMessage;

/** Server-side fallback: on a policy decline the API re-runs the request on its default fallback model. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** A web-search turn can pause; resume it this many times before giving up. */
const MAX_RESUMES = 3;
const MAX_TOKENS = 64_000;

/**
 * The JSON object in the model's final text. Tolerates a ```json fence or a sentence before it
 * (web search answers sometimes add one). Returns null when there is none, so the step's schema
 * check fails with AI_OUTPUT_INVALID and the spend is still recorded.
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

const finalText = (message: Message) =>
  message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");

export class ClaudeTextProvider implements TextProvider {
  readonly name = "claude" as const;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    // The SDK retries 408/409/429/5xx and connection errors itself
    this.client = new Anthropic({ apiKey, maxRetries: LLM.retries, timeout: LLM.timeoutMs });
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const model = MODELS[request.tier];
    const tools: Anthropic.Beta.BetaToolUnion[] =
      request.task === "research" && AI.researchWebSearch
        ? [{ type: "web_search_20260209", name: "web_search", max_uses: AI.researchSearchMaxUses, allowed_domains: AI.researchSearchDomains }]
        : [];
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: request.prompt }];
    const usage: Required<CallUsage> = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 };

    let message: Message | null = null;
    for (let turn = 0; turn <= MAX_RESUMES; turn++) {
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
    if (!message) {
      throw new ApiError(502, "AI_UNAVAILABLE", "The model returned no answer.");
    }
    if (message.stop_reason === "refusal") {
      throw new ApiError(502, "AI_REFUSED", "The model declined this request. Rephrase the brief or the feedback and try again.");
    }
    if (message.stop_reason === "max_tokens") {
      throw new ApiError(502, "AI_OUTPUT_TRUNCATED", "The model's answer was cut off. Try a smaller size or fewer competencies.");
    }
    return { json: extractJson(finalText(message)), model: message.model, usage, costUsd: priceUsd(request.tier, usage) };
  }

  /** Streams (long answers would otherwise hit HTTP timeouts) and returns the finished message. */
  private async send(model: string, tier: ModelTier, messages: Anthropic.Beta.BetaMessageParam[], tools: Anthropic.Beta.BetaToolUnion[]) {
    try {
      return await this.request(model, tier, messages, tools);
    } catch (err) {
      throw describeApiError(err);
    }
  }

  private request(model: string, tier: ModelTier, messages: Anthropic.Beta.BetaMessageParam[], tools: Anthropic.Beta.BetaToolUnion[]) {
    return this.client.beta.messages
      .stream({
        model,
        max_tokens: MAX_TOKENS,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        // Thinking is always on for these models; effort sets its depth
        output_config: { effort: tier === "complex" ? LLM.complexEffort : LLM.defaultEffort },
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
    return new ApiError(502, "AI_AUTH", "The Claude API key was rejected. Check ANTHROPIC_API_KEY.");
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
