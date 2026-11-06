-- How many of a call's output tokens were thinking, for the "thinking share" in the AI response report.
-- Nullable: calls logged before this migration, and the mock, did not measure it.
ALTER TABLE ai_calls ADD COLUMN IF NOT EXISTS thinking_tokens INTEGER;
