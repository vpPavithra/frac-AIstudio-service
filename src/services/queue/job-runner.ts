import { randomUUID } from "node:crypto";
import type { Job } from "../../models/job.model.ts";
import type { JobRepository } from "../../repositories/job.repository.ts";
import { ApiError } from "../../utils/response.ts";
import { describeError, logger } from "../../utils/logger.ts";

/** Code for a job that threw something other than an ApiError. */
export const JOB_FAILED = "JOB_FAILED";

export interface JobProgress {
  /** Updates the message shown in the UI and, optionally, the x-of-y counter. */
  (msg: string, done?: number, total?: number): Promise<void>;
}

export type JobTask = (progress: JobProgress) => Promise<void>;

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

    const run = this.run(job.id, task).finally(() => this.running.delete(run));
    this.running.add(run);
    return job;
  }

  /** Resolves once every started job has settled. Used by tests and graceful shutdown. */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  private async run(id: string, task: JobTask): Promise<void> {
    const progress: JobProgress = (msg, done, total) => this.jobs.update(id, { msg, done, total });
    try {
      await this.jobs.update(id, { status: "running" });
      await task(progress);
      await this.jobs.update(id, { status: "done" });
    } catch (err) {
      const message = describeError(err);
      const errorCode = err instanceof ApiError ? err.code : JOB_FAILED;
      logger.warn("Job failed", { jobId: id, errorCode, error: message });
      await this.jobs.update(id, { status: "error", error: message, errorCode });
    }
  }
}
