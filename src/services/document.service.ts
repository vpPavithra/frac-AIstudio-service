// DOCUMENT SERVICE: documents a team attaches to a FRAC (review decisions, Nov 2026). A job description or
// government order ("brief") is reduced to text for the research step. A standard Roles, Competencies or
// Sources sheet is imported straight into the FRAC and recorded in `frac.uploads`, so that step uses the sheet
// instead of the AI (see the step files). Also serves the templates users fill in before uploading.
// Called by controllers/document.controller.ts; wired in server.ts. The uploaded file itself is never stored.
import { randomUUID } from "node:crypto";
import type { DocumentKind, DocumentSummary, FracDocument } from "../models/document.model.ts";
import type { Frac, FracCompetency, SheetKind } from "../models/frac.model.ts";
import type { Repositories } from "../repositories/index.ts";
import { DOCUMENTS } from "../config/constants.ts";
import { badRequest, notFound } from "../utils/response.ts";
import { buildTemplateWorkbook } from "./excel/workbook-writer.ts";
import { readCsv } from "./excel/csv-reader.ts";
import { readWorkbook } from "./excel/workbook-reader.ts";
import { extractDocumentText } from "./documents/extract-text.ts";
import { importCompetenciesSheet, importRolesSheet, importSourcesSheet, type RolesImport } from "./documents/import-sheets.ts";
import { BRIEF_GUIDE, SHEET_FORMATS } from "./documents/sheet-formats.ts";
import type { SheetData } from "./review-engine/parse-workbook.ts";
import { jobRunning } from "./queue/job-runner.ts";
import type { FracService } from "./frac.service.ts";
import { markChecked, stampChanges } from "./step-changes.ts";

/** What the portal lists for a document: everything except the extracted text. */
export type DocumentInfo = Omit<FracDocument, "text" | "ownerId"> & { chars: number };

/** An uploaded file as multer hands it over. */
export interface UploadedFile {
  name: string;
  buffer: Buffer;
  mime: string;
}

const SHEET_EXTENSIONS = /\.(xlsx|csv)$/i;
const SHEET_LABELS: Record<SheetKind, string> = { roles: "Roles", competencies: "Competencies", sources: "Sources" };

const info = ({ text, ownerId: _owner, ...rest }: FracDocument): DocumentInfo => ({ ...rest, chars: text.length });

/** An .xlsx or .csv file as sheets; 400 FILE_TYPE_NOT_ALLOWED for anything else, FILE_UNREADABLE when it cannot be read. */
async function readSheets(file: UploadedFile): Promise<SheetData[]> {
  if (!SHEET_EXTENSIONS.test(file.name)) throw badRequest("FILE_TYPE_NOT_ALLOWED", "Upload the sheet as .xlsx or .csv");
  if (/\.csv$/i.test(file.name)) return readCsv(file.buffer, file.name);
  try {
    return await readWorkbook(file.buffer);
  } catch {
    throw badRequest("FILE_UNREADABLE", `Could not read ${file.name}. Save it again as .xlsx and upload it.`);
  }
}

/**
 * A Roles sheet replaces the roles and activities; its posting columns replace the postings when it has
 * any. Competency mappings are cleared, so rolesDirty asks the Competencies step to map them again.
 */
export function applyRolesImport(frac: Frac, imported: RolesImport, filename: string): Frac {
  return {
    ...frac,
    roles: imported.roles,
    postings: imported.postings.length ? imported.postings : frac.postings,
    rolesDirty: frac.competencies.length > 0,
    reviewStale: frac.review ? true : frac.reviewStale,
    uploads: { ...frac.uploads, roles: filename },
  };
}

/**
 * A Competencies sheet replaces the competencies (ladders included where the sheet has all five levels).
 * Mappings to codes that no longer exist are cleared; rolesDirty sends the team to the Competencies step,
 * which then only maps activities to these codes.
 */
export function applyCompetenciesImport(frac: Frac, competencies: FracCompetency[], filename: string): Frac {
  const codes = new Set(competencies.map((c) => c.code));
  const keep = (comp: string) => (codes.has(comp.split("@")[0].trim()) ? comp : "");
  return {
    ...frac,
    competencies,
    roles: frac.roles.map((r) => ({ ...r, activities: r.activities.map((a) => ({ ...a, comp: keep(a.comp) })) })),
    rolesDirty: frac.roles.some((r) => r.activities.length > 0),
    reviewStale: frac.review ? true : frac.reviewStale,
    uploads: { ...frac.uploads, competencies: filename },
  };
}

/** A Sources sheet replaces the research sources now when research exists; otherwise research uses it when it runs. */
export function applySourcesImport(frac: Frac, sources: NonNullable<DocumentSummary["sources"]>, filename: string): Frac {
  return {
    ...frac,
    research: frac.research ? { ...frac.research, sources } : frac.research,
    reviewStale: frac.review && frac.research ? true : frac.reviewStale,
    uploads: { ...frac.uploads, sources: filename },
  };
}

export class DocumentService {
  constructor(
    private readonly repos: Repositories,
    private readonly fracs: FracService,
  ) {}

  /** The FRAC's documents (owner-checked), oldest first, without their text. */
  async list(ownerId: string, fracId: string): Promise<DocumentInfo[]> {
    await this.fracs.get(ownerId, fracId);
    return (await this.repos.documents.listForFrac(fracId)).map(info);
  }

  /**
   * Attaches one document. "brief": text extracted and stored (400 TOO_MANY_DOCUMENTS past
   * DOCUMENTS.maxBriefFiles); after research it stamps the brief as changed, so research shows as needing attention. A sheet: imported into the FRAC, which is snapshotted
   * first so the upload can be undone from History; a newer sheet of the same kind replaces the older record.
   * Refused with 409 JOB_RUNNING while a step runs on the FRAC, whose result would overwrite the import.
   */
  async upload(ownerId: string, fracId: string, kind: DocumentKind, file: UploadedFile): Promise<{ document: DocumentInfo; frac: Frac }> {
    const frac = await this.fracs.get(ownerId, fracId);
    const active = await this.repos.jobs.activeFor(fracId);
    if (active) throw jobRunning(active);
    const existing = await this.repos.documents.listForFrac(fracId);

    const base = { id: randomUUID(), fracId, ownerId, kind, filename: file.name, mime: file.mime, bytes: file.buffer.length, createdAt: new Date().toISOString() };
    if (kind === "brief") {
      if (existing.filter((d) => d.kind === "brief").length >= DOCUMENTS.maxBriefFiles) {
        throw badRequest("TOO_MANY_DOCUMENTS", `A FRAC can have at most ${DOCUMENTS.maxBriefFiles} documents. Remove one first.`);
      }
      const { text, truncated } = await extractDocumentText(file.name, file.buffer);
      const warnings = truncated ? [`Only the first ${DOCUMENTS.maxChars.toLocaleString("en-IN")} characters are used.`] : [];
      const doc: FracDocument = { ...base, text, parsed: { counts: { characters: text.length }, warnings } };
      await this.repos.documents.insert(doc);
      return { document: info(doc), frac: await this.briefChanged(frac) };
    }

    const sheets = await readSheets(file);
    let next: Frac;
    let parsed: DocumentSummary;
    if (kind === "roles") {
      const imported = importRolesSheet(sheets);
      next = applyRolesImport(frac, imported, file.name);
      parsed = { counts: { roles: imported.roles.length, activities: imported.roles.reduce((n, r) => n + r.activities.length, 0), postings: imported.postings.length }, warnings: imported.warnings };
    } else if (kind === "competencies") {
      const imported = importCompetenciesSheet(sheets);
      next = applyCompetenciesImport(frac, imported.competencies, file.name);
      parsed = { counts: { competencies: imported.competencies.length, ladders: imported.competencies.filter((c) => c.levels).length }, warnings: imported.warnings };
    } else {
      const imported = importSourcesSheet(sheets);
      next = applySourcesImport(frac, imported.sources, file.name);
      parsed = { counts: { sources: imported.sources.length }, warnings: imported.warnings, sources: imported.sources };
    }

    await this.repos.fracs.snapshot(frac, `Before ${SHEET_LABELS[kind]} sheet upload`);
    const at = new Date().toISOString();
    next = stampChanges(frac, { ...next, updatedAt: at }, at);
    await this.repos.fracs.update(next);
    for (const old of existing.filter((d) => d.kind === kind)) await this.repos.documents.delete(fracId, old.id);
    const doc: FracDocument = { ...base, text: "", parsed };
    await this.repos.documents.insert(doc);
    return { document: info(doc), frac: next };
  }

  /**
   * Removes a document. For a sheet, the FRAC keeps the imported content but the step goes back to using the
   * AI (`uploads[kind]` is cleared). 404 when the FRAC or the document is not this owner's.
   */
  async remove(ownerId: string, fracId: string, documentId: string): Promise<Frac> {
    const frac = await this.fracs.get(ownerId, fracId);
    const doc = (await this.repos.documents.listForFrac(fracId)).find((d) => d.id === documentId);
    if (!doc) throw notFound("Document");
    await this.repos.documents.delete(fracId, documentId);
    if (doc.kind === "brief") return this.briefChanged(frac);
    if (!frac.uploads?.[doc.kind]) return frac;
    const uploads = { ...frac.uploads };
    delete uploads[doc.kind];
    const next: Frac = { ...frac, uploads, updatedAt: new Date().toISOString() };
    await this.repos.fracs.update(next);
    return next;
  }

  /** After research, a brief document added or removed leaves research out of date: stamps the brief and saves. */
  private async briefChanged(frac: Frac): Promise<Frac> {
    if (!frac.research) return frac;
    const at = new Date().toISOString();
    const next = markChecked({ ...frac, updatedAt: at }, "brief", at);
    await this.repos.fracs.update(next);
    return next;
  }

  /** A template to fill in before uploading: an .xlsx for a sheet kind, a text guide for "brief". */
  static async template(kind: DocumentKind): Promise<{ buffer: Buffer; filename: string; type: "xlsx" | "text" }> {
    if (kind === "brief") return { buffer: Buffer.from(BRIEF_GUIDE, "utf8"), filename: "FRAC Studio - job description guide.txt", type: "text" };
    return { buffer: await buildTemplateWorkbook(SHEET_FORMATS[kind]), filename: `FRAC Studio - ${SHEET_LABELS[kind]} template.xlsx`, type: "xlsx" };
  }
}
