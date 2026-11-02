import { MemoryJobRepository } from "../repositories/job.repository.ts";
import type { Job } from "../models/job.model.ts";
import { INTERRUPTED_MESSAGE, JOB_INTERRUPTED, startJobWatchdog, sweepStuckJobs } from "./job-watchdog.service.ts";

const MINUTE = 60_000;

function job(id: string, status: Job["status"], minutesAgo: number): Job {
  const at = new Date(Date.now() - minutesAgo * MINUTE).toISOString();
  return {
    id, ownerId: "u1", kind: "review", targetId: null, status, msg: "", done: 0, total: 0,
    error: null, errorCode: null, usage: {}, createdAt: at, updatedAt: at,
  };
}

describe("job watchdog", () => {
  it("fails only queued or running jobs untouched for longer than the stale window", async () => {
    const jobs = new MemoryJobRepository();
    await jobs.insert(job("stale-running", "running", 30));
    await jobs.insert(job("stale-queued", "queued", 30));
    await jobs.insert(job("fresh-running", "running", 1));
    await jobs.insert(job("old-done", "done", 30));

    expect(await sweepStuckJobs(jobs, 15 * MINUTE)).toBe(2);
    expect(await jobs.get("stale-running")).toMatchObject({ status: "error", error: INTERRUPTED_MESSAGE, errorCode: JOB_INTERRUPTED });
    expect(await jobs.get("stale-queued")).toMatchObject({ status: "error", errorCode: JOB_INTERRUPTED });
    expect((await jobs.get("fresh-running"))?.status).toBe("running");
    expect((await jobs.get("old-done"))?.status).toBe("done");
  });

  it("sweeps once on start, so jobs left by a previous process are cleared at boot", async () => {
    const jobs = new MemoryJobRepository();
    await jobs.insert(job("left-behind", "running", 60));
    const stop = startJobWatchdog(jobs, { staleAfterMs: 15 * MINUTE, sweepEveryMs: 60 * MINUTE });
    await new Promise((resolve) => setImmediate(resolve));
    stop();
    expect((await jobs.get("left-behind"))?.status).toBe("error");
  });
});
