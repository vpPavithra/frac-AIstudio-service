// Documents a team attaches to a FRAC (spec review decisions, Nov 2026): a job description or government
// order the research step reads, or a standard sheet that replaces an AI step. Stored in frac_documents by
// repositories/document.repository.ts; the uploaded file itself is never kept. Types only, no logic.
import type { FracSource, SheetKind } from "./frac.model.ts";

/** "brief": a JD or government order (PDF, DOCX, TXT) for research; the others are standard sheets. */
export type DocumentKind = "brief" | SheetKind;

/** What an import read from a standard sheet; `sources` keeps the rows so research can use them later. */
export interface DocumentSummary {
  counts: Record<string, number>;
  warnings: string[];
  sources?: FracSource[];
}

export interface FracDocument {
  id: string;
  fracId: string;
  ownerId: string;
  kind: DocumentKind;
  filename: string;
  mime: string;
  bytes: number;
  /** Extracted text of a brief document, capped at DOCUMENTS.maxChars; "" for sheets. */
  text: string;
  parsed: DocumentSummary | null;
  createdAt: string;
}
