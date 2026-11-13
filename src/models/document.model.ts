// Documents a team attaches to a FRAC (spec review decisions, Nov 2026): a job description or government
// order the research step reads, or a standard sheet that replaces an AI step. Stored in frac_documents by
// repositories/document.repository.ts; the uploaded file itself is never kept. Types only, no logic.
import type { FracCompetency, FracRole, FracSource, Posting, SheetKind } from "./frac.model.ts";
import type { Finding } from "./report.model.ts";

/** A rule-based expert-check finding about an uploaded sheet, worked out at upload (no AI). */
export type SheetCheck = Pick<Finding, "check" | "sev" | "title" | "detail" | "fix" | "refs">;

/** "brief": a JD or government order (PDF, DOCX, TXT) for research; the others are standard sheets. */
export type DocumentKind = "brief" | SheetKind;

/**
 * What an import read from a standard sheet. The rows are kept so the sheet can be re-applied after edits
 * (DocumentService.reapply); `sources` is also what research uses. Sheets uploaded before Nov 13 2026 have counts only.
 */
export interface DocumentSummary {
  counts: Record<string, number>;
  warnings: string[];
  sources?: FracSource[];
  roles?: FracRole[];
  postings?: Posting[];
  competencies?: FracCompetency[];
  /** The expert check's rule-based findings about this sheet's rows, as at the upload (roles and competencies sheets). */
  checks?: SheetCheck[];
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
