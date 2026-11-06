// GEMINI PROVIDER (profile kind "gemini" in config/ai-providers.json, key in its keyEnv, normally
// GEMINI_API_KEY). Works on the free tier ("gemini-free") and the paid tier ("gemini-paid"): the profile
// gives the model and thinking level per tier, web search on or off, the prices and the free-tier flag.
// Steps build the prompt and validate the JSON; this file only sends the prompt, extracts the JSON and
// prices the call. Reads LLM.maxTokens, LLM.retries, LLM.timeoutMs, LLM.maxRetryDelayMs and AI.research*.
import { ApiError as GeminiApiError, FinishReason, GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { GenerateContentConfig, GenerateContentResponse } from "@google/genai";
import type { AiProfile, ThinkingLevel as Level } from "../../config/ai-providers.ts";
import { AI, LLM } from "../../config/constants.ts";
import { ApiError } from "../../utils/response.ts";
import { extractJson } from "./json.ts";
import { priceUsd } from "./pricing.ts";
import type { CallUsage, CompletionRequest, CompletionResult, TextProvider } from "./types.ts";

/** The profile's low | medium | high as Gemini's thinkingLevel. */
const LEVELS: Record<Level, ThinkingLevel> = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH };

/** Finish reasons that mean the model declined or was blocked, shown as AI_REFUSED. */
const DECLINED = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
]);

/** First wait before the SDK retries a 408/429/5xx, in seconds. Long enough for a per-minute quota to clear. */
const FIRST_RETRY_DELAY_S = 5;

const SYSTEM = "Answer with one JSON object only, in the shape the prompt asks for. No prose before or after it.";

/**
 * Tokens and searches from a Gemini response. promptTokenCount already includes the cached tokens, which
 * pricing.ts takes back out; thinking tokens are billed as output. Every non-empty search query is billed.
 */
export function geminiUsage(response: Pick<GenerateContentResponse, "usageMetadata" | "candidates">): CallUsage {
  const u = response.usageMetadata ?? {};
  const queries = response.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [];
  return {
    inputTokens: (u.promptTokenCount ?? 0) + (u.toolUsePromptTokenCount ?? 0),
    outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    thinkingTokens: u.thoughtsTokenCount ?? 0,
    cacheReadTokens: u.cachedContentTokenCount ?? 0,
    webSearches: queries.filter((q) => q.trim()).length,
  };
}

/** TextProvider backed by the Gemini API. Created by registry.ts createAi for a profile of kind "gemini". */
export class GeminiTextProvider implements TextProvider {
  readonly name: string;
  private readonly client: GoogleGenAI;

  constructor(
    private readonly profile: AiProfile,
    apiKey: string,
  ) {
    this.name = profile.name;
    this.client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        timeout: LLM.timeoutMs,
        // The SDK retries 408/429/5xx with exponential backoff; delays are in seconds
        retryOptions: { attempts: LLM.retries + 1, initialDelay: FIRST_RETRY_DELAY_S, maxDelay: LLM.maxRetryDelayMs / 1000 },
      },
    });
  }

  /**
   * One step's call. Only research gets Google Search (spec 5.2), and only when the profile allows it.
   * Gemini cannot limit search to named sites, so the allowed domains are put in the instructions.
   * JSON mode is used whenever search is off (the two cannot be combined).
   * Throws AI_REFUSED or AI_OUTPUT_TRUNCATED on those finish reasons, and the codes from describeGeminiError.
   */
  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const model = this.profile.models[request.tier];
    const search = request.task === "research" && this.profile.webSearch && AI.researchWebSearch;
    const domains = AI.researchSearchDomains.length ? ` Search only these sites: ${AI.researchSearchDomains.join(", ")}.` : "";
    const config: GenerateContentConfig = {
      systemInstruction: search ? SYSTEM + domains : SYSTEM,
      maxOutputTokens: LLM.maxTokens,
      thinkingConfig: { thinkingLevel: LEVELS[this.profile.thinking[request.tier]] },
      ...(search ? { tools: [{ googleSearch: {} }] } : { responseMimeType: "application/json" }),
    };

    let response: GenerateContentResponse;
    try {
      response = await this.client.models.generateContent({ model, contents: request.prompt, config });
    } catch (err) {
      throw describeGeminiError(err, model);
    }

    const finish = response.candidates?.[0]?.finishReason;
    if (response.promptFeedback?.blockReason || (finish && DECLINED.has(finish))) {
      throw new ApiError(502, "AI_REFUSED", "The model declined this request. Rephrase the brief or the feedback and try again.");
    }
    if (finish === FinishReason.MAX_TOKENS) {
      throw new ApiError(502, "AI_OUTPUT_TRUNCATED", "The model's answer was cut off. Try a smaller size or fewer competencies.");
    }
    const usage = geminiUsage(response);
    return {
      json: extractJson(response.text ?? ""),
      text: response.text ?? "",
      model: response.modelVersion ?? model,
      usage,
      costUsd: priceUsd(this.profile.rates, request.tier, usage),
      estimated: this.profile.freeTier,
    };
  }
}

/** SDK errors (after its own retries) as the coded errors the portal shows on the job. */
export function describeGeminiError(err: unknown, model: string): unknown {
  if (!(err instanceof GeminiApiError)) {
    return err;
  }
  // Gemini answers a bad key with 400 INVALID_ARGUMENT "API key not valid", not 401
  if (err.status === 401 || err.status === 403 || /api key/i.test(err.message)) {
    return new ApiError(502, "AI_AUTH", "The Gemini API key was rejected. Check the key in .env or the secret store.");
  }
  if (err.status === 429) {
    return new ApiError(503, "AI_BUSY", "The Gemini quota is used up for now (on the free tier, per minute or per day). Try again later.");
  }
  if (err.status === 404) {
    return new ApiError(502, "AI_REQUEST_REJECTED", `The model "${model}" is not available to this key. Check the profile in config/ai-providers.json.`);
  }
  if (err.status === 400) {
    return new ApiError(502, "AI_REQUEST_REJECTED", `The model rejected the request: ${err.message}`);
  }
  // 503 "high demand" and 504 deadline are Google-side overloads; the status tells them apart from an outage
  return new ApiError(502, "AI_UNAVAILABLE", `The model "${model}" is unavailable right now (HTTP ${err.status}). Try again shortly, or switch the model in config/ai-providers.json.`);
}
