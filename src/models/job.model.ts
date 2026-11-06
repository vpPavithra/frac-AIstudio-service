// Background job record, polled by the portal through GET /v1/jobs/:id. Created and updated by
// services/queue/job-runner.ts, stored by repositories/job.repository.ts. Types only.

export type JobStatus = "queued" | "running" | "done" | "error";

/**
 * One long-running task (a generation step, an expert check or a review). `kind` names it ("research",
 * "check", "review" …), `targetId` is the FRAC or review it works on, `done`/`total` drive the progress
 * bar, and `usage` is the model spend so far (calls, tokens, costUsd).
 */
export interface Job {
  id: string;
  ownerId: string;
  kind: string;
  targetId: string | null;
  status: JobStatus;
  msg: string;
  done: number;
  total: number;
  error: string | null;
  /** Stable code for `error` (e.g. JOB_INTERRUPTED), so the portal can branch on it. */
  errorCode: string | null;
  usage: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

/** The fields a running job may change; everything else is fixed at creation. */
export type JobPatch = Partial<Pick<Job, "status" | "msg" | "done" | "total" | "error" | "errorCode" | "usage">>;
