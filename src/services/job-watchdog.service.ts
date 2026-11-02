import type { JobRepository } from "../repositories/job.repository.ts";
import { describeError, logger } from "../utils/logger.ts";

export const JOB_INTERRUPTED = "JOB_INTERRUPTED";
export const INTERRUPTED_MESSAGE = "This step was interrupted (the service restarted or the step stopped responding). Run it again.";

/**
 * Fails queued/running jobs nobody has touched for `staleAfterMs`. Jobs run in-process, so a
 * restart leaves their rows "running" forever and the portal would poll a spinner indefinitely.
 * Every progress update refreshes updated_at, so a live job is not swept.
 */
export async function sweepStuckJobs(jobs: JobRepository, staleAfterMs: number, now = new Date()): Promise<number> {
  const failed = await jobs.failStale(new Date(now.getTime() - staleAfterMs), INTERRUPTED_MESSAGE, JOB_INTERRUPTED);
  if (failed) logger.warn("Marked stuck jobs as interrupted", { failed, staleAfterMs });
  return failed;
}

/**
 * Sweeps once now (to clear jobs a previous process left behind) and then on an interval.
 * The timer is unref'd so it never keeps the process alive. Returns a stop function.
 */
export function startJobWatchdog(jobs: JobRepository, opts: { staleAfterMs: number; sweepEveryMs: number }): () => void {
  const sweep = () => {
    sweepStuckJobs(jobs, opts.staleAfterMs).catch((err: unknown) => {
      logger.error("Job watchdog sweep failed", { error: describeError(err) });
    });
  };
  sweep();
  const timer = setInterval(sweep, opts.sweepEveryMs);
  timer.unref();
  return () => clearInterval(timer);
}
