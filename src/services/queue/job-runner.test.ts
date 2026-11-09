import { MemoryJobRepository } from "../../repositories/job.repository.ts";
import { JobRunner } from "./job-runner.ts";

const spec = { ownerId: "u1", kind: "review", targetId: null, msg: "Working…" };

describe("JobRunner", () => {
  it("records progress and finishes as done", async () => {
    const jobs = new MemoryJobRepository();
    const runner = new JobRunner(jobs);
    const job = await runner.start(spec, async (progress) => {
      await progress("Batch 1", 1, 3);
    });
    expect(job.status).toBe("queued");
    await runner.idle();
    expect(await jobs.get(job.id)).toMatchObject({ status: "done", msg: "Batch 1", done: 1, total: 3, error: null });
  });

  it("keeps a long-running job fresh for the watchdog, and never revives it after it finishes", async () => {
    const jobs = new MemoryJobRepository();
    const runner = new JobRunner(jobs, 10);
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const job = await runner.start(spec, async () => {
      await pause(30);
      const startedAt = (await jobs.get(job.id))?.updatedAt ?? "";
      await pause(40); // one slow model call, no progress writes
      expect((await jobs.get(job.id))?.updatedAt > startedAt).toBe(true);
    });
    await runner.idle();
    await pause(40);
    expect(await jobs.get(job.id)).toMatchObject({ status: "done", msg: "Working…" });
  });

  it("stores the error message when the task fails", async () => {
    const jobs = new MemoryJobRepository();
    const runner = new JobRunner(jobs);
    const job = await runner.start(spec, async () => {
      throw new Error("LLM timed out");
    });
    await runner.idle();
    expect(await jobs.get(job.id)).toMatchObject({ status: "error", error: "LLM timed out" });
  });

  it("stops a job at its billed spending limit, after recording the call that crossed it; estimates never stop it", async () => {
    const jobs = new MemoryJobRepository();
    const runner = new JobRunner(jobs, undefined, undefined, 0.5);
    let calls = 0;
    const job = await runner.start(spec, async (_progress, recordUsage) => {
      for (let i = 0; i < 5; i++) {
        await recordUsage({ inputTokens: 100, outputTokens: 100, costUsd: 0.3 });
        calls++;
      }
    });
    await runner.idle();
    expect(calls).toBe(1);
    expect(await jobs.get(job.id)).toMatchObject({ status: "error", errorCode: "AI_BUDGET_EXCEEDED", usage: { calls: 2, costUsd: 0.6 } });

    const free = await runner.start(spec, async (_progress, recordUsage) => {
      for (let i = 0; i < 5; i++) await recordUsage({ inputTokens: 100, outputTokens: 100, costUsd: 0.3, estimated: true });
    });
    await runner.idle();
    expect(await jobs.get(free.id)).toMatchObject({ status: "done", usage: { calls: 5 } });
  });
});
