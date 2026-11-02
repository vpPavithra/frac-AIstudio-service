-- A stable code next to the job's error message, so the portal can branch on why a job failed
-- (e.g. JOB_INTERRUPTED from the watchdog) instead of parsing prose.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS error_code TEXT;
CREATE INDEX IF NOT EXISTS jobs_status_updated_idx ON jobs (status, updated_at);
