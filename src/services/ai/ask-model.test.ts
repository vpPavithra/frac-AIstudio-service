import { z } from "zod";
import { MemoryAiCallRepository } from "../../repositories/ai-call.repository.ts";
import { MemoryJobRepository } from "../../repositories/job.repository.ts";
import type { TextProvider } from "../../providers/text/types.ts";
import { ApiError } from "../../utils/response.ts";
import { JobRunner } from "../queue/job-runner.ts";
import { askModel } from "./ask-model.ts";

const shape = z.object({ roles: z.array(z.string()) });
const answering = (json: unknown): TextProvider => ({
  name: "gemini-free",
  complete: async () => ({ json, model: "gemini-3.8-flash", usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 10 }, costUsd: 0.001, estimated: true }),
});
const ask = (provider: TextProvider) => (_progress: unknown, recordUsage: Parameters<typeof askModel>[2]) =>
  askModel({ provider, task: "roles", tier: "complex", prompt: "p", input: {} }, shape, recordUsage).then(() => undefined);

async function runJob(provider: TextProvider) {
  const jobs = new MemoryJobRepository();
  const aiCalls = new MemoryAiCallRepository();
  const runner = new JobRunner(jobs, 60_000, aiCalls);
  const job = await runner.start({ ownerId: "u1", kind: "roles", targetId: null, msg: "Working" }, ask(provider));
  await runner.idle();
  return { job: await jobs.get(job.id), calls: await aiCalls.listSince(new Date(0)) };
}

describe("askModel and the per-call AI log", () => {
  it("logs an answered call with its provider, model, task, tokens, cost and the job it belongs to", async () => {
    const { job, calls } = await runJob(answering({ roles: ["ANM at sub-centre"] }));
    expect(job).toMatchObject({ status: "done", usage: { calls: 1, inputTokens: 100, outputTokens: 20, estimated: 1 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      jobId: job?.id,
      jobKind: "roles",
      provider: "gemini-free",
      model: "gemini-3.8-flash",
      task: "roles",
      tier: "complex",
      outcome: "ok",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 10,
      costUsd: 0.001,
      estimated: true,
    });
    expect(calls[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(calls[0].startedAt ?? "")).toBeLessThanOrEqual(Date.parse(calls[0].createdAt));
  });

  it("logs wrong-shape answers as invalid, still billed, retries once, then fails the job with AI_OUTPUT_INVALID", async () => {
    const { job, calls } = await runJob(answering({ roles: "not a list" }));
    expect(job).toMatchObject({ status: "error", errorCode: "AI_OUTPUT_INVALID", usage: { calls: 2, inputTokens: 200 } });
    expect(calls.map((c) => c.outcome)).toEqual(["invalid", "invalid"]);
  });

  it("logs a provider error with its code and no tokens, and passes the error on", async () => {
    const busy: TextProvider = { name: "gemini-free", complete: () => Promise.reject(new ApiError(503, "AI_BUSY", "quota")) };
    const { job, calls } = await runJob(busy);
    expect(job).toMatchObject({ status: "error", errorCode: "AI_BUSY" });
    expect(calls).toEqual([expect.objectContaining({ outcome: "AI_BUSY", model: "", inputTokens: 0, costUsd: 0 })]);
  });
});

describe("askModel retry on an unreadable answer", () => {
  it("asks once more, logs both attempts, and succeeds when the second answer is good", async () => {
    let n = 0;
    const flaky: TextProvider = {
      name: "claude",
      complete: async () => ({
        json: n++ === 0 ? null : { roles: ["ANM"] },
        text: n === 1 ? '{"roles": ["unterminated' : "",
        model: "claude-sonnet-5-5",
        usage: { inputTokens: 10, outputTokens: 5 },
        costUsd: 0.01,
      }),
    };
    const { job, calls } = await runJob(flaky);
    expect(job).toMatchObject({ status: "done", usage: { calls: 2 } });
    expect(calls.map((c) => c.outcome)).toEqual(["invalid", "ok"]);
  });

  it("does not count the wait for a free slot as the model's time", async () => {
    const queued: TextProvider = {
      name: "gemini-free",
      complete: async () => ({ json: { roles: ["x"] }, model: "m", usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0, queuedMs: 60_000 }),
    };
    const { calls } = await runJob(queued);
    expect(calls[0].latencyMs).toBeLessThan(1_000);
  });
});
