// Storage for FRACs (`fracs` table) and their version snapshots (`frac_versions`). Used by FracService
// and ReviewService (open-in-creator). Built by repositories/index.ts.
import type { Pool } from "pg";
import type { Frac, FracVersion } from "../models/frac.model.ts";
import { byNewest, clone, iso } from "./row-helpers.ts";

// FRAC documents and their version snapshots. The FRAC lives in `doc`; the other columns are copies
// for listing and indexing. The memory store runs tests and local work without Postgres.

/** FRAC storage. Reads do not check the owner; services do that after `get`. */
export interface FracRepository {
  insert(frac: Frac): Promise<void>;
  update(frac: Frac): Promise<void>;
  get(id: string): Promise<Frac | null>;
  listByOwner(ownerId: string): Promise<Frac[]>;
  /** The owner's FRACs whose position (cadre) equals `cadre`, ignoring case and surrounding spaces; newest first. */
  findByCadre(ownerId: string, cadre: string): Promise<Frac[]>;
  /** Saves a full copy of the FRAC as a new version, labelled with `reason` (e.g. "Expert check"). */
  snapshot(frac: Frac, reason: string): Promise<void>;
  /** Version list (no documents), newest first. */
  versions(fracId: string): Promise<FracVersion[]>;
  version(fracId: string, versionId: number): Promise<Frac | null>;
}

/** Postgres implementation. The whole Frac is stored as JSONB in `doc`. */
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

  async findByCadre(ownerId: string, cadre: string): Promise<Frac[]> {
    const { rows } = await this.pool.query<{ doc: Frac }>(
      `SELECT doc FROM fracs WHERE owner_id = $1 AND lower(trim(cadre)) = lower(trim($2)) ORDER BY updated_at DESC`,
      [ownerId, cadre],
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

/** In-memory implementation for tests and FRAC_STUDIO_STORE=memory. Copies on the way in and out. */
export class MemoryFracRepository implements FracRepository {
  private readonly rows = new Map<string, Frac>();
  private readonly snapshots: (FracVersion & { doc: Frac })[] = [];
  private seq = 0;

  async insert(frac: Frac): Promise<void> {
    this.rows.set(frac.id, clone(frac));
  }

  async update(frac: Frac): Promise<void> {
    this.rows.set(frac.id, clone(frac));
  }

  async get(id: string): Promise<Frac | null> {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  async listByOwner(ownerId: string): Promise<Frac[]> {
    return [...this.rows.values()]
      .filter((f) => f.ownerId === ownerId)
      .map((f) => ({ f, at: f.updatedAt }))
      .sort(byNewest)
      .map(({ f }) => clone(f));
  }

  async findByCadre(ownerId: string, cadre: string): Promise<Frac[]> {
    const wanted = cadre.trim().toLowerCase();
    return (await this.listByOwner(ownerId)).filter((f) => f.cadre.trim().toLowerCase() === wanted);
  }

  async snapshot(frac: Frac, reason: string): Promise<void> {
    this.seq++;
    this.snapshots.push({
      id: this.seq,
      fracId: frac.id,
      step: frac.step,
      reason,
      createdAt: new Date().toISOString(),
      doc: clone(frac),
    });
  }

  async versions(fracId: string): Promise<FracVersion[]> {
    return this.snapshots
      .filter((v) => v.fracId === fracId)
      .sort((a, b) => b.id - a.id)
      .map(({ doc: _doc, ...meta }) => meta);
  }

  async version(fracId: string, versionId: number): Promise<Frac | null> {
    const hit = this.snapshots.find((v) => v.fracId === fracId && v.id === versionId);
    return hit ? clone(hit.doc) : null;
  }
}
