// IN-PROCESS JOB RUNNER for every long-running operation: Creator steps 2-5, the expert check and uploaded
// reviews. Starts a task without awaiting it, keeps its jobs row current (status, msg, done/total, usage)
// and turns an error into status "error" with a stable code. Created once in src/server.ts and shared by
// FracService and ReviewService. Stuck rows left by a restart are failed by job-watchdog.service.ts.
import { randomUUID } from "node:crypto";
import { JOBS } from "../../config/constants.ts";
import type { AiCall } from "../../models/ai-call.model.ts";
import type { Job, JobPatch } from "../../models/job.model.ts";
import type { AiCallRepository } from "../../repositories/ai-call.repository.ts";
import type { JobRepository } from "../../repositories/job.repository.ts";
import { jobContext } from "../../utils/context.ts";
import { ApiError } from "../../utils/response.ts";
import { describeError, logger } from "../../utils/logger.ts";
import { INTERRUPTED_MESSAGE, JOB_INTERRUPTED } from "../job-watchdog.service.ts";

/** Code for a job that threw something other than an ApiError (an ApiError keeps its own code, e.g. AI_OUTPUT_INVALID). */
export const JOB_FAILED = "JOB_FAILED";
/** 409 when a target already has a live job; `details` carries its jobId and kind so the portal can follow it. */
export const JOB_RUNNING = "JOB_RUNNING";

/** The 409 for a target that already has a live job. */
const jobRunning = (job: Job) =>
  new ApiError(409, JOB_RUNNING, "A step is already running on this FRAC. Wait for it to finish.", { jobId: job.id, kind: job.kind });

/** Postgres unique violation on jobs_one_active_per_target (two starts in the same moment). */
const isActiveJobClash = (err: unknown) =>
  (err as { code?: string; constraint?: string })?.code === "23505" && (err as { constraint?: string }).constraint === "jobs_one_active_per_target";

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
  /** The cost is an estimate at list prices, not a bill (the mock, or a free-tier key). */
  estimated?: boolean;
  /** Who answered and how, for the per-call AI log (ai_calls). Set by services/ai/ask-model.ts. */
  call?: Pick<AiCall, "provider" | "model" | "task" | "tier" | "outcome" | "latencyMs" | "cacheReadTokens" | "thinkingTokens" | "startedAt">;
}

/** Adds one model call's spend to the job's running total (jobs.usage). */
export type RecordUsage = (delta: UsageDelta) => Promise<void>;

/** The work a job does; it reports through `progress` and `recordUsage` and throws to fail the job. */
export type JobTask = (progress: JobProgress, recordUsage: RecordUsage) => Promise<void>;

/** The row fields a new job starts with. `kind` is the step name, "check" or "review". */
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

  /**
   * `heartbeatMs`: how often a running job touches its row (JOB_HEARTBEAT_MS); tests pass a short one.
   * `aiCalls`: where each model call's record goes (the AI response report); omitted, calls are not logged.
   */
  constructor(
    private readonly jobs: JobRepository,
    private readonly heartbeatMs = JOBS.heartbeatMs,
    private readonly aiCalls?: AiCallRepository,
  ) {}

  /** Inserts the job as queued and returns it at once; the task runs in the background (fire and forget). */
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

    const run = this.run(job.id, job.kind, job.msg, task).finally(() => this.running.delete(run));
    this.running.add(run);
    return job;
  }

  /**
   * Like start, but refuses a second live job on the same target (409 JOB_RUNNING with the live job's id).
   * A live job touches its row every heartbeat; one silent for two heartbeats is taken as dead, marked
   * JOB_INTERRUPTED, and the new job starts, so a crashed job never blocks its FRAC for long.
   */
  async startExclusive(spec: StartJob, task: JobTask, now = Date.now()): Promise<Job> {
    if (!spec.targetId) return this.start(spec, task);
    const active = await this.jobs.activeFor(spec.targetId);
    if (active) {
      if (now - Date.parse(active.updatedAt) < 2 * this.heartbeatMs) throw jobRunning(active);
      await this.jobs.update(active.id, { status: "error", error: INTERRUPTED_MESSAGE, errorCode: JOB_INTERRUPTED });
      logger.warn("Replaced a silent job", { jobId: active.id, kind: active.kind, targetId: spec.targetId });
    }
    try {
      return await this.start(spec, task);
    } catch (err) {
      const live = isActiveJobClash(err) ? await this.jobs.activeFor(spec.targetId) : null;
      if (live) throw jobRunning(live);
      throw err;
    }
  }

  /** Resolves once every started job has settled. Used by tests and graceful shutdown. */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  private async run(id: string, kind: string, msg: string, task: JobTask): Promise<void> {
    // Batches run in parallel and each writes a snapshot of the job; chaining the writes keeps them in
    // order, so an older snapshot (fewer calls, a lower usage total or count) can never land after a newer one.
    // A failed write rejects only its own caller; the chain carries on for the next write
    let writes: Promise<unknown> = Promise.resolve();
    const write = (patch: JobPatch): Promise<void> => {
      const next = writes.then(() => this.jobs.update(id, patch));
      writes = next.catch(() => undefined);
      return next.then(() => undefined);
    };
    let lastMsg = msg;
    const progress: JobProgress = (next, done, total) => {
      lastMsg = next;
      return write({ msg: next, done, total });
    };
    // One model call can outlast the watchdog's stale window (a long research call makes no progress writes),
    // so a running job re-writes its current message on a timer. That only moves updated_at; it never
    // changes the status. Stopped before the final status is written, so a beat can never land after it.
    const heartbeat = setInterval(() => void write({ msg: lastMsg }).catch(() => undefined), this.heartbeatMs);
    heartbeat.unref();
    // jobs.usage is numbers only, so `estimated` is stored as 1 when any call's cost is an estimate
    const usage: Record<string, number> = { calls: 0, inputTokens: 0, outputTokens: 0, webSearches: 0, costUsd: 0 };
    const recordUsage: RecordUsage = (delta) => {
      usage.calls += 1;
      usage.inputTokens += delta.inputTokens;
      usage.outputTokens += delta.outputTokens;
      usage.webSearches += delta.webSearches ?? 0;
      usage.costUsd = Math.round((usage.costUsd + delta.costUsd) * 10_000) / 10_000;
      if (delta.estimated) usage.estimated = 1;
      // The per-call log is for reporting only: a failed insert is logged, never fails the job
      if (delta.call && this.aiCalls) {
        const row: AiCall = {
          ...delta.call,
          jobId: id,
          jobKind: kind,
          inputTokens: delta.inputTokens,
          outputTokens: delta.outputTokens,
          webSearches: delta.webSearches ?? 0,
          costUsd: delta.costUsd,
          estimated: delta.estimated ?? false,
          createdAt: new Date().toISOString(),
        };
        void this.aiCalls.insert(row).catch((err: unknown) => logger.warn("AI call log write failed", { jobId: id, error: describeError(err) }));
      }
      return write({ usage: { ...usage } });
    };
    try {
      await write({ status: "running" });
      // The job context lets askModel tag its "AI call started / finished" log lines with this job
      await jobContext.run({ jobId: id, kind }, () => task(progress, recordUsage));
      clearInterval(heartbeat);
      await write({ status: "done" });
      // One log line per job with its total tokens and cost (spec 9); also logged on failure below
      if (usage.calls) logger.info("Job spend", { jobId: id, kind, ...usage });
    } catch (err) {
      const message = describeError(err);
      const errorCode = err instanceof ApiError ? err.code : JOB_FAILED;
      logger.warn("Job failed", { jobId: id, kind, errorCode, error: message, ...(usage.calls ? { usage } : {}) });
      clearInterval(heartbeat);
      await write({ status: "error", error: message, errorCode });
    } finally {
      clearInterval(heartbeat);
    }
  }
}
