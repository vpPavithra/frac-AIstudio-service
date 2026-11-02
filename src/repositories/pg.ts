import type { Pool } from "pg";
import type { Frac } from "../engine/types.js";
import type {
  FracRepository,
  FracVersion,
  Job,
  JobPatch,
  JobRepository,
  Repositories,
  ReviewRecord,
  ReviewRepository,
} from "./types.js";

// Postgres stores over migrations/001_init.sql. The FRAC itself lives in `doc`; the other
// columns are copies for listing and indexing.

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : v);

export class PgFracRepository implements FracRepository {
  constructor(private readonly pool: Pool) {}

  async insert(f: Frac): Promise<void> {
    await this.pool.query(
      `INSERT INTO fracs (id, owner_id, cadre, state, step, doc, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [f.id, f.ownerId, f.cadre, f.state, f.step, f, f.createdAt, f.updatedAt],
    );
  }

  async update(f: Frac): Promise<void> {
    await this.pool.query(
      `UPDATE fracs SET cadre = $2, state = $3, step = $4, doc = $5, updated_at = $6 WHERE id = $1`,
      [f.id, f.cadre, f.state, f.step, f, f.updatedAt],
    );
  }

  async get(id: string): Promise<Frac | null> {
    const { rows } = await this.pool.query<{ doc: Frac }>(`SELECT doc FROM fracs WHERE id = $1`, [id]);
    return rows[0]?.doc ?? null;
  }

  async listByOwner(ownerId: string): Promise<Frac[]> {
    const { rows } = await this.pool.query<{ doc: Frac }>(
      `SELECT doc FROM fracs WHERE owner_id = $1 ORDER BY updated_at DESC`,
      [ownerId],
    );
    return rows.map((r) => r.doc);
  }

  async snapshot(f: Frac, reason: string): Promise<void> {
    await this.pool.query(`INSERT INTO frac_versions (frac_id, step, reason, doc) VALUES ($1, $2, $3, $4)`, [
      f.id,
      f.step,
      reason,
      f,
    ]);
  }

  async versions(fracId: string): Promise<FracVersion[]> {
    const { rows } = await this.pool.query<{ id: string; step: number; reason: string; created_at: Date }>(
      `SELECT id, step, reason, created_at FROM frac_versions WHERE frac_id = $1 ORDER BY id DESC`,
      [fracId],
    );
    return rows.map((r) => ({ id: Number(r.id), fracId, step: r.step, reason: r.reason, createdAt: iso(r.created_at) }));
  }

  async version(fracId: string, versionId: number): Promise<Frac | null> {
    const { rows } = await this.pool.query<{ doc: Frac }>(
      `SELECT doc FROM frac_versions WHERE frac_id = $1 AND id = $2`,
      [fracId, versionId],
    );
    return rows[0]?.doc ?? null;
  }
}

interface ReviewRow {
  id: string;
  owner_id: string;
  frac_id: string | null;
  kind: ReviewRecord["kind"];
  source_name: string | null;
  ctx: ReviewRecord["ctx"];
  source_model: ReviewRecord["sourceModel"];
  report: ReviewRecord["report"];
  created_at: Date;
}

const toReview = (r: ReviewRow): ReviewRecord => ({
  id: r.id,
  ownerId: r.owner_id,
  fracId: r.frac_id,
  kind: r.kind,
  sourceName: r.source_name ?? "",
  ctx: r.ctx ?? {},
  sourceModel: r.source_model,
  report: r.report,
  createdAt: iso(r.created_at),
});

export class PgReviewRepository implements ReviewRepository {
  constructor(private readonly pool: Pool) {}

  async insert(r: ReviewRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO reviews (id, owner_id, frac_id, kind, source_name, ctx, source_model, report, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [r.id, r.ownerId, r.fracId, r.kind, r.sourceName, r.ctx, r.sourceModel, r.report, r.createdAt],
    );
  }

  async update(r: ReviewRecord): Promise<void> {
    await this.pool.query(
      `UPDATE reviews SET frac_id = $2, ctx = $3, source_model = $4, report = $5 WHERE id = $1`,
      [r.id, r.fracId, r.ctx, r.sourceModel, r.report],
    );
  }

  async get(id: string): Promise<ReviewRecord | null> {
    const { rows } = await this.pool.query<ReviewRow>(`SELECT * FROM reviews WHERE id = $1`, [id]);
    return rows[0] ? toReview(rows[0]) : null;
  }

  async listByOwner(ownerId: string): Promise<ReviewRecord[]> {
    const { rows } = await this.pool.query<ReviewRow>(
      `SELECT * FROM reviews WHERE owner_id = $1 ORDER BY created_at DESC`,
      [ownerId],
    );
    return rows.map(toReview);
  }
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
    const r = rows[0];
    if (!r) return null;
    return {
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
    };
  }
}

export function pgRepositories(pool: Pool): Repositories {
  return {
    fracs: new PgFracRepository(pool),
    reviews: new PgReviewRepository(pool),
    jobs: new PgJobRepository(pool),
  };
}
