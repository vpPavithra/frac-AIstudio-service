import type { Frac, Report, ReviewModel } from "../engine/types.js";

export type JobStatus = "queued" | "running" | "done" | "error";
export type ReviewKind = "upload" | "expert-check";

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

export interface ReviewContext {
  cadre?: string;
  state?: string;
  notes?: string;
}

export interface ReviewRecord {
  id: string;
  ownerId: string;
  fracId: string | null;
  kind: ReviewKind;
  sourceName: string;
  ctx: ReviewContext;
  sourceModel: ReviewModel | null;
  report: Report | null;
  createdAt: string;
}

export interface FracVersion {
  id: number;
  fracId: string;
  step: number;
  reason: string;
  createdAt: string;
}

export interface FracRepository {
  insert(frac: Frac): Promise<void>;
  update(frac: Frac): Promise<void>;
  get(id: string): Promise<Frac | null>;
  listByOwner(ownerId: string): Promise<Frac[]>;
  snapshot(frac: Frac, reason: string): Promise<void>;
  versions(fracId: string): Promise<FracVersion[]>;
  version(fracId: string, versionId: number): Promise<Frac | null>;
}

export interface ReviewRepository {
  insert(review: ReviewRecord): Promise<void>;
  update(review: ReviewRecord): Promise<void>;
  get(id: string): Promise<ReviewRecord | null>;
  listByOwner(ownerId: string): Promise<ReviewRecord[]>;
}

export type JobPatch = Partial<Pick<Job, "status" | "msg" | "done" | "total" | "error" | "errorCode" | "usage">>;

export interface JobRepository {
  insert(job: Job): Promise<void>;
  update(id: string, patch: JobPatch): Promise<void>;
  get(id: string): Promise<Job | null>;
  /** Marks queued/running jobs last updated before `before` as failed; returns how many. */
  failStale(before: Date, error: string, errorCode: string): Promise<number>;
}

export interface Repositories {
  fracs: FracRepository;
  reviews: ReviewRepository;
  jobs: JobRepository;
}
