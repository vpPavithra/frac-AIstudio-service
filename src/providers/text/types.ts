// The one seam between FRAC Studio's AI steps and a model. Steps build the prompt and validate the
// JSON; a provider only turns a request into JSON plus its spend. Claude (claude.ts) when an API key
// is set; the sample-data mock in src/mocks otherwise. See src/providers/registry.ts.

/**
 * Which step is calling (spec 5.2–5.5, 6.4). A provider may use it to shape its answer.
 * The review has two (rules r3 §6): the per-competency scope/accuracy checklist and the state-fit call.
 */
export type AiTask = "research" | "roles" | "activities" | "competencies" | "ladders" | "review-competencies" | "review-state";

/** Spec 9: complex tier for research, roles, competencies and review; default for activities and ladders. */
export type ModelTier = "complex" | "default";

export interface CompletionRequest {
  task: AiTask;
  tier: ModelTier;
  /** The full prompt text sent to a real model. */
  prompt: string;
  /** The structured facts the prompt was built from; the mock answers from these instead of the text. Claude ignores it. */
  input: unknown;
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

export interface CompletionResult {
  /** Parsed JSON in the step's output shape (validated by the step). */
  json: unknown;
  model: string;
  usage: CallUsage;
  costUsd: number;
  /** True when the cost is an estimate at Claude prices rather than a real bill (the mock). */
  estimated?: boolean;
}

export interface TextProvider {
  /** "claude" or "mock"; shown by GET /v1/info and in the startup log. */
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
