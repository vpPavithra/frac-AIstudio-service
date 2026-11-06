-- One row per AI model call, for the AI response report (npm run ai:report) and release notes.
-- Written by the job runner through services/ai/ask-model.ts; no prompt or answer text is stored.
-- outcome: "ok", "invalid" (answer had the wrong shape) or the provider's error code (AI_BUSY, AI_AUTH, ...).
CREATE TABLE IF NOT EXISTS ai_calls (
  id                 BIGSERIAL PRIMARY KEY,
  job_id             UUID REFERENCES jobs (id) ON DELETE SET NULL,
  job_kind           TEXT,
  provider           TEXT        NOT NULL,
  model              TEXT        NOT NULL,
  task               TEXT        NOT NULL,
  tier               TEXT        NOT NULL,
  outcome            TEXT        NOT NULL,
  latency_ms         INTEGER     NOT NULL,
  input_tokens       INTEGER     NOT NULL DEFAULT 0,
  output_tokens      INTEGER     NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER     NOT NULL DEFAULT 0,
  web_searches       INTEGER     NOT NULL DEFAULT 0,
  cost_usd           NUMERIC(12, 6) NOT NULL DEFAULT 0,
  estimated          BOOLEAN     NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_calls_created_idx ON ai_calls (created_at);
CREATE INDEX IF NOT EXISTS ai_calls_job_idx ON ai_calls (job_id);
