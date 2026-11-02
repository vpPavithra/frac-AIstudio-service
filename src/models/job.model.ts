// Background job record, polled by the portal through GET /v1/jobs/:id.

export type JobStatus = "queued" | "running" | "done" | "error";

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

export type JobPatch = Partial<Pick<Job, "status" | "msg" | "done" | "total" | "error" | "errorCode" | "usage">>;
