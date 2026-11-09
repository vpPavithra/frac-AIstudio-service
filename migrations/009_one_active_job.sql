-- At most one queued or running job per FRAC or review, so a reload, a second tab or a double click cannot
-- start a second paid job on the same target (services/queue/job-runner.ts startExclusive checks first; this
-- index closes the race between two requests that arrive together). Older duplicates, if any, are failed first.
UPDATE jobs SET status = 'error', error_code = 'JOB_INTERRUPTED',
  error = 'This step was interrupted (the service restarted or the step stopped responding). Run it again.'
WHERE status IN ('queued', 'running') AND target_id IS NOT NULL AND id NOT IN (
  SELECT DISTINCT ON (target_id) id FROM jobs
  WHERE status IN ('queued', 'running') AND target_id IS NOT NULL
  ORDER BY target_id, created_at DESC
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active_per_target ON jobs (target_id)
  WHERE status IN ('queued', 'running') AND target_id IS NOT NULL;
