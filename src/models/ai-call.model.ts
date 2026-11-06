// One AI model call as recorded for the AI response report (migrations/004_ai_calls.sql). Built by
// services/ai/ask-model.ts, stored by the job runner through repositories/ai-call.repository.ts, read by
// scripts/ai-report.ts. Holds measurements only: no prompt or answer text.

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
  webSearches: number;
  costUsd: number;
  estimated: boolean;
  createdAt: string;
}
