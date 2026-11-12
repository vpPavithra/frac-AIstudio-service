// Storage for the documents attached to a FRAC (`frac_documents` table, migration 010). Used by
// DocumentService (upload, list, delete) and FracService (research reads the brief text and source rows).
// Built by repositories/index.ts.
import type { Pool } from "pg";
import type { DocumentKind, DocumentSummary, FracDocument } from "../models/document.model.ts";
import { clone, iso } from "./row-helpers.ts";

/** Document storage. Reads do not check the owner; DocumentService does that through the FRAC. */
export interface DocumentRepository {
  insert(doc: FracDocument): Promise<void>;
  /** Oldest first, so the research prompt lists them in upload order. */
  listForFrac(fracId: string): Promise<FracDocument[]>;
  /** Removes one document of this FRAC; false when there is none. */
  delete(fracId: string, id: string): Promise<boolean>;
}

interface DocumentRow {
  id: string;
  frac_id: string;
  owner_id: string;
  kind: DocumentKind;
  filename: string;
  mime: string;
  bytes: number;
  text: string;
  parsed: DocumentSummary | null;
  created_at: Date | string;
}

const fromRow = (r: DocumentRow): FracDocument => ({
  id: r.id,
  fracId: r.frac_id,
  ownerId: r.owner_id,
  kind: r.kind,
  filename: r.filename,
  mime: r.mime,
  bytes: Number(r.bytes),
  text: r.text,
  parsed: r.parsed,
  createdAt: iso(r.created_at),
});

export class PgDocumentRepository implements DocumentRepository {
  constructor(private readonly pool: Pool) {}

  async insert(d: FracDocument): Promise<void> {
    await this.pool.query(
      `INSERT INTO frac_documents (id, frac_id, owner_id, kind, filename, mime, bytes, text, parsed, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [d.id, d.fracId, d.ownerId, d.kind, d.filename, d.mime, d.bytes, d.text, d.parsed === null ? null : JSON.stringify(d.parsed), d.createdAt],
    );
  }

  async listForFrac(fracId: string): Promise<FracDocument[]> {
    const { rows } = await this.pool.query<DocumentRow>(`SELECT * FROM frac_documents WHERE frac_id = $1 ORDER BY created_at, id`, [fracId]);
    return rows.map(fromRow);
  }

  async delete(fracId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`DELETE FROM frac_documents WHERE frac_id = $1 AND id = $2`, [fracId, id]);
    return (rowCount ?? 0) > 0;
  }
}

/** In-memory implementation for tests and FRAC_STUDIO_STORE=memory. Copies on the way in and out. */
export class MemoryDocumentRepository implements DocumentRepository {
  private readonly rows: FracDocument[] = [];

  async insert(doc: FracDocument): Promise<void> {
    this.rows.push(clone(doc));
  }

  async listForFrac(fracId: string): Promise<FracDocument[]> {
    return this.rows.filter((d) => d.fracId === fracId).map(clone);
  }

  async delete(fracId: string, id: string): Promise<boolean> {
    const at = this.rows.findIndex((d) => d.fracId === fracId && d.id === id);
    if (at < 0) return false;
    this.rows.splice(at, 1);
    return true;
  }
}
