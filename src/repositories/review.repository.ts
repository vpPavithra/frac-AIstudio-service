// Storage for reviews (`reviews` table): uploads and Creator expert checks. Used only by ReviewService
// (FracService reaches reviews through ReviewService). Built by repositories/index.ts.
import type { Pool } from "pg";
import type { ReviewRecord } from "../models/review.model.ts";
import { byNewest, clone, iso } from "./row-helpers.ts";

/** Review storage. Reads do not check the owner except listByOwner/findByFingerprint; services check after `get`. */
export interface ReviewRepository {
  insert(review: ReviewRecord): Promise<void>;
  update(review: ReviewRecord): Promise<void>;
  get(id: string): Promise<ReviewRecord | null>;
  listByOwner(ownerId: string): Promise<ReviewRecord[]>;
  /** The owner's newest finished upload review with this fingerprint (rules r3 §9), or null. */
  findByFingerprint(ownerId: string, fingerprint: string): Promise<ReviewRecord | null>;
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
  fingerprint: string | null;
  created_at: Date;
}

/** Postgres row → ReviewRecord. */
const toReview = (r: ReviewRow): ReviewRecord => ({
  id: r.id,
  ownerId: r.owner_id,
  fracId: r.frac_id,
  kind: r.kind,
  sourceName: r.source_name ?? "",
  ctx: r.ctx ?? {},
  sourceModel: r.source_model,
  report: r.report,
  fingerprint: r.fingerprint,
  createdAt: iso(r.created_at),
});

export class PgReviewRepository implements ReviewRepository {
  constructor(private readonly pool: Pool) {}

  async insert(r: ReviewRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO reviews (id, owner_id, frac_id, kind, source_name, ctx, source_model, report, fingerprint, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [r.id, r.ownerId, r.fracId, r.kind, r.sourceName, r.ctx, r.sourceModel, r.report, r.fingerprint ?? null, r.createdAt],
    );
  }

  async update(r: ReviewRecord): Promise<void> {
    await this.pool.query(
      `UPDATE reviews SET frac_id = $2, ctx = $3, source_model = $4, report = $5, fingerprint = $6 WHERE id = $1`,
      [r.id, r.fracId, r.ctx, r.sourceModel, r.report, r.fingerprint ?? null],
    );
  }

  async findByFingerprint(ownerId: string, fingerprint: string): Promise<ReviewRecord | null> {
    const { rows } = await this.pool.query<ReviewRow>(
      `SELECT * FROM reviews WHERE owner_id = $1 AND fingerprint = $2 AND kind = 'upload' AND report IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [ownerId, fingerprint],
    );
    return rows[0] ? toReview(rows[0]) : null;
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

export class MemoryReviewRepository implements ReviewRepository {
  private readonly rows = new Map<string, ReviewRecord>();

  async insert(review: ReviewRecord): Promise<void> {
    this.rows.set(review.id, clone(review));
  }

  async update(review: ReviewRecord): Promise<void> {
    this.rows.set(review.id, clone(review));
  }

  async get(id: string): Promise<ReviewRecord | null> {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  async listByOwner(ownerId: string): Promise<ReviewRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.ownerId === ownerId)
      .map((r) => ({ r, at: r.createdAt }))
      .sort(byNewest)
      .map(({ r }) => clone(r));
  }

  async findByFingerprint(ownerId: string, fingerprint: string): Promise<ReviewRecord | null> {
    const hit = (await this.listByOwner(ownerId)).find((r) => r.kind === "upload" && r.fingerprint === fingerprint && r.report);
    return hit ?? null;
  }
}
