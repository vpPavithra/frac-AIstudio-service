import { randomUUID } from "node:crypto";
import type { Job, JobPatch } from "../../models/job.model.ts";
import type { JobRepository } from "../../repositories/job.repository.ts";
import { ApiError } from "../../utils/response.ts";
import { describeError, logger } from "../../utils/logger.ts";

/** Code for a job that threw something other than an ApiError. */
export const JOB_FAILED = "JOB_FAILED";

export interface JobProgress {
  /** Updates the message shown in the UI and, optionally, the x-of-y counter. */
  (msg: string, done?: number, total?: number): Promise<void>;
}

/** Token and cost spend of one model call (spec 9: log tokens and cost per job). */
export interface UsageDelta {
  inputTokens: number;
  outputTokens: number;
  webSearches?: number;
  costUsd: number;
  /** The mock's cost is what the same tokens would cost on Claude, not a bill. */
  estimated?: boolean;
}

/** Adds one model call's spend to the job's running total (jobs.usage). */
export type RecordUsage = (delta: UsageDelta) => Promise<void>;

export type JobTask = (progress: JobProgress, recordUsage: RecordUsage) => Promise<void>;

export interface StartJob {
  ownerId: string;
  kind: string;
  targetId: string | null;
  msg: string;
  total?: number;
}

/**
 * Runs long steps in-process and records progress in the jobs table so the UI can poll
 * GET /v1/jobs/:id (spec 2, "Long steps"). One process is enough for v1; a queue can replace
 * this later without changing the API.
 */
export class JobRunner {
  private readonly running = new Set<Promise<void>>();

  constructor(private readonly jobs: JobRepository) {}

  async start(spec: StartJob, task: JobTask): Promise<Job> {
    const now = new Date().toISOString();
    const job: Job = {
      id: randomUUID(),
      ownerId: spec.ownerId,
      kind: spec.kind,
      targetId: spec.targetId,
      status: "queued",
      msg: spec.msg,
      done: 0,
      total: spec.total ?? 0,
      error: null,
      errorCode: null,
      usage: {},
      createdAt: now,
      updatedAt: now,
    };
    await this.jobs.insert(job);

    const run = this.run(job.id, job.kind, task).finally(() => this.running.delete(run));
    this.running.add(run);
    return job;
  }

  /** Resolves once every started job has settled. Used by tests and graceful shutdown. */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  private async run(id: string, kind: string, task: JobTask): Promise<void> {
    // Batches run in parallel and each writes a snapshot of the job; chaining the writes keeps them in
    // order, so an older snapshot (fewer calls, a lower count) can never land after a newer one
    let writes: Promise<unknown> = Promise.resolve();
    const write = (patch: JobPatch): Promise<void> => {
      const next = writes.then(() => this.jobs.update(id, patch));
      writes = next.catch(() => undefined);
      return next.then(() => undefined);
    };
    const progress: JobProgress = (msg, done, total) => write({ msg, done, total });
    // jobs.usage is numbers only, so `estimated` is stored as 1 when any call's cost is an estimate
    const usage: Record<string, number> = { calls: 0, inputTokens: 0, outputTokens: 0, webSearches: 0, costUsd: 0 };
    const recordUsage: RecordUsage = (delta) => {
      usage.calls += 1;
      usage.inputTokens += delta.inputTokens;
      usage.outputTokens += delta.outputTokens;
      usage.webSearches += delta.webSearches ?? 0;
      usage.costUsd = Math.round((usage.costUsd + delta.costUsd) * 10_000) / 10_000;
      if (delta.estimated) usage.estimated = 1;
      return write({ usage: { ...usage } });
    };
    try {
      await write({ status: "running" });
      await task(progress, recordUsage);
      await write({ status: "done" });
      if (usage.calls) logger.info("Job spend", { jobId: id, kind, ...usage });
    } catch (err) {
      const message = describeError(err);
      const errorCode = err instanceof ApiError ? err.code : JOB_FAILED;
      logger.warn("Job failed", { jobId: id, kind, errorCode, error: message, ...(usage.calls ? { usage } : {}) });
      await write({ status: "error", error: message, errorCode });
    }
  }
}
