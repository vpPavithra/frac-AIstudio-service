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

  it("stores the error message when the task fails", async () => {
    const jobs = new MemoryJobRepository();
    const runner = new JobRunner(jobs);
    const job = await runner.start(spec, async () => {
      throw new Error("LLM timed out");
    });
    await runner.idle();
    expect(await jobs.get(job.id)).toMatchObject({ status: "error", error: "LLM timed out" });
  });
});
