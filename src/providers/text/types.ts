// The one seam between FRAC Studio's AI steps and a model. Steps build the prompt and validate the
// JSON; a provider only turns a request into JSON plus its spend. AI_PROVIDER picks a profile in
// config/ai-providers.json (Gemini, Claude, ...) or the sample-data mock in src/mocks. See src/providers/registry.ts.
import type { ZodType } from "zod/v4";

/**
 * Which step is calling (spec 5.2–5.5, 6.4). A provider may use it to shape its answer.
 * The review has two (rules r3 §6): the per-competency scope/accuracy checklist and the state-fit call.
 */
export type AiTask = "research" | "roles" | "activities" | "competencies" | "ladders" | "review-competencies" | "review-state";

/**
 * Spec 9: complex tier for research, roles, competencies and review; default for activities and ladders.
 * Each provider profile (config/ai-providers.json) names a model and thinking level per tier.
 */
export type ModelTier = "complex" | "default";

/** One model call, as a step hands it to the provider. */
export interface CompletionRequest {
  task: AiTask;
  tier: ModelTier;
  /** The full prompt text sent to a real model. */
  prompt: string;
  /** The structured facts the prompt was built from; the mock answers from these instead of the text. Real providers ignore it. */
  input: unknown;
  /** The step's output shape. A provider that can enforce it (Claude structured output) may; the step validates it either way. */
  schema?: ZodType;
}

/** Tokens and searches one call consumed, as the API reports them. */
export interface CallUsage {
  /** Every input token, cached ones included. */
  inputTokens: number;
  /** Visible answer plus thinking. */
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Web searches the research step ran (billed per search). */
  webSearches?: number;
}

/** What a provider returns. `json` is null when the answer held no JSON object; the step's schema rejects it. */
export interface CompletionResult {
  /** Parsed JSON in the step's output shape (validated by the step). */
  json: unknown;
  model: string;
  usage: CallUsage;
  costUsd: number;
  /** True when the cost is an estimate at list prices rather than a real bill (the mock, or a free tier). */
  estimated?: boolean;
  /** The model's final text, kept only to explain an unreadable answer in the log. Never stored. */
  text?: string;
  /** Time spent waiting for a free slot (providers/text/limit.ts) before the call was sent; not the model's time. */
  queuedMs?: number;
}

/** The provider seam. Implemented by ClaudeTextProvider, GeminiTextProvider and src/mocks' MockTextProvider; chosen by registry.ts. */
export interface TextProvider {
  /** The profile name (e.g. "gemini-free", "claude") or "mock"; shown by GET /v1/info and in the startup log. */
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
