// Storage for background jobs (`jobs` table). Written by services/queue/job-runner.ts as a job
// progresses, read by GET /v1/jobs/:id, and swept by services/job-watchdog.service.ts. Built by index.ts.
import type { Pool } from "pg";
import type { Job, JobPatch } from "../models/job.model.ts";
import { clone, iso } from "./row-helpers.ts";

/** Job storage. `update` writes only the fields present in the patch and always bumps updated_at. */
export interface JobRepository {
  insert(job: Job): Promise<void>;
  update(id: string, patch: JobPatch): Promise<void>;
  get(id: string): Promise<Job | null>;
  /** Marks queued/running jobs last updated before `before` as failed; returns how many. */
  failStale(before: Date, error: string, errorCode: string): Promise<number>;
  /** Every job created at or after `since`, oldest first (the AI response report). */
  listSince(since: Date): Promise<Job[]>;
}

interface JobRow {
  id: string;
  owner_id: string;
  kind: string;
  target_id: string | null;
  status: Job["status"];
  msg: string | null;
  done: number;
  total: number;
  error: string | null;
  error_code: string | null;
  usage: Job["usage"];
  created_at: Date;
  updated_at: Date;
}

// Patch field → column. Also an allowlist: only these names are ever put into the UPDATE statement
const JOB_COLUMNS: Record<keyof JobPatch, string> = {
  status: "status",
  msg: "msg",
  done: "done",
  total: "total",
  error: "error",
  errorCode: "error_code",
  usage: "usage",
};

export class PgJobRepository implements JobRepository {
  constructor(private readonly pool: Pool) {}

  async insert(j: Job): Promise<void> {
    await this.pool.query(
      `INSERT INTO jobs (id, owner_id, kind, target_id, status, msg, done, total, error, error_code, usage, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [j.id, j.ownerId, j.kind, j.targetId, j.status, j.msg, j.done, j.total, j.error, j.errorCode, j.usage, j.createdAt, j.updatedAt],
    );
  }

  async failStale(before: Date, error: string, errorCode: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE jobs SET status = 'error', error = $2, error_code = $3, updated_at = now()
       WHERE status IN ('queued', 'running') AND updated_at < $1`,
      [before, error, errorCode],
    );
    return rowCount ?? 0;
  }

  async update(id: string, patch: JobPatch): Promise<void> {
    const keys = (Object.keys(patch) as (keyof JobPatch)[]).filter((k) => patch[k] !== undefined);
    if (!keys.length) return;
    const sets = keys.map((k, i) => `${JOB_COLUMNS[k]} = $${i + 2}`);
    await this.pool.query(`UPDATE jobs SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, [
      id,
      ...keys.map((k) => patch[k]),
    ]);
  }

  async get(id: string): Promise<Job | null> {
    const { rows } = await this.pool.query<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [id]);
    return rows[0] ? toJob(rows[0]) : null;
  }

  async listSince(since: Date): Promise<Job[]> {
    const { rows } = await this.pool.query<JobRow>(`SELECT * FROM jobs WHERE created_at >= $1 ORDER BY created_at`, [since]);
    return rows.map(toJob);
  }
}

/** Postgres row → Job. */
const toJob = (r: JobRow): Job => ({
  id: r.id,
  ownerId: r.owner_id,
  kind: r.kind,
  targetId: r.target_id,
  status: r.status,
  msg: r.msg ?? "",
  done: r.done,
  total: r.total,
  error: r.error,
  errorCode: r.error_code ?? null,
  usage: r.usage ?? {},
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export class MemoryJobRepository implements JobRepository {
  private readonly rows = new Map<string, Job>();

  async insert(job: Job): Promise<void> {
    this.rows.set(job.id, clone(job));
  }

  async update(id: string, patch: JobPatch): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, ...clone(patch), updatedAt: new Date().toISOString() });
  }

  async get(id: string): Promise<Job | null> {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  async failStale(before: Date, error: string, errorCode: string): Promise<number> {
    let failed = 0;
    for (const [id, row] of this.rows) {
      const inFlight = row.status === "queued" || row.status === "running";
      if (inFlight && new Date(row.updatedAt) < before) {
        this.rows.set(id, { ...row, status: "error", error, errorCode, updatedAt: new Date().toISOString() });
        failed++;
      }
    }
    return failed;
  }

  async listSince(since: Date): Promise<Job[]> {
    return [...this.rows.values()]
      .filter((j) => new Date(j.createdAt) >= since)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }
}
