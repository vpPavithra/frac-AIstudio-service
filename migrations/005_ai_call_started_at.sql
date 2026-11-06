-- When each AI call was sent, for the per-call list in the AI response report. created_at stays the time
-- the call finished. Nullable: calls logged before this migration have no start time.
ALTER TABLE ai_calls ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS ai_calls_started_idx ON ai_calls (started_at);
