// One AI model call as recorded for the AI response report (migrations/004_ai_calls.sql). Built by
// services/ai/ask-model.ts, stored by the job runner through repositories/ai-call.repository.ts, read by
// tools/reports/run-ai-report.ts. Holds measurements only: no prompt or answer text.

/** "ok", "invalid" (the answer failed the step's schema) or the provider's error code (AI_BUSY, AI_AUTH, ...). */
export type AiCallOutcome = "ok" | "invalid" | (string & {});

export interface AiCall {
  jobId: string | null;
  /** The job's kind: research, roles, competencies, ladders, check, review. */
  jobKind: string | null;
  /** The provider profile name, e.g. "gemini-free", "claude", "mock". */
  provider: string;
  /** The model id the provider reported, or the profile's model when the call failed before answering. */
  model: string;
  task: string;
  tier: string;
  outcome: AiCallOutcome;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** The thinking part of outputTokens; null when the provider did not report it (the mock, older rows). */
  thinkingTokens: number | null;
  webSearches: number;
  costUsd: number;
  estimated: boolean;
  /** When the call was sent to the model (after any wait for a free slot); null on rows logged before 005. */
  startedAt: string | null;
  /** When the call finished and was logged. */
  createdAt: string;
}
