// Stored AI checklist answers (`review_answer_cache` table), keyed by a fingerprint of everything the answer
// depends on. Read and written by services/ai-review.service.ts so a repeat check skips unchanged competencies.
// Built by index.ts. Insert-only: a changed competency has a new key.
import type { Pool } from "pg";
import { clone } from "./row-helpers.ts";

export type ReviewAnswerKind = "competency" | "state";

export interface ReviewAnswerCacheRepository {
  /** The stored answers for the keys that have one. */
  getMany(keys: string[]): Promise<Map<string, unknown>>;
  /** Stores answers; a key already stored keeps its first answer. */
  putMany(entries: { key: string; kind: ReviewAnswerKind; answer: unknown }[]): Promise<void>;
}

export class PgReviewAnswerCacheRepository implements ReviewAnswerCacheRepository {
  constructor(private readonly pool: Pool) {}

  async getMany(keys: string[]): Promise<Map<string, unknown>> {
    if (!keys.length) return new Map();
    const { rows } = await this.pool.query<{ key: string; answer: unknown }>(`SELECT key, answer FROM review_answer_cache WHERE key = ANY($1)`, [keys]);
    return new Map(rows.map((r) => [r.key, r.answer]));
  }

  async putMany(entries: { key: string; kind: ReviewAnswerKind; answer: unknown }[]): Promise<void> {
    for (const e of entries) {
      await this.pool.query(`INSERT INTO review_answer_cache (key, kind, answer) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`, [e.key, e.kind, JSON.stringify(e.answer)]);
    }
  }
}

export class MemoryReviewAnswerCacheRepository implements ReviewAnswerCacheRepository {
  private readonly rows = new Map<string, unknown>();

  async getMany(keys: string[]): Promise<Map<string, unknown>> {
    return new Map(keys.filter((k) => this.rows.has(k)).map((k) => [k, clone(this.rows.get(k))]));
  }

  async putMany(entries: { key: string; kind: ReviewAnswerKind; answer: unknown }[]): Promise<void> {
    for (const e of entries) if (!this.rows.has(e.key)) this.rows.set(e.key, clone(e.answer));
  }
}
