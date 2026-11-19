// DOCUMENT SERVICE: documents a team attaches to a FRAC (review decisions, Nov 2026). A job description or
// government order ("brief") is reduced to text for the research step. A standard Roles, Competencies or
// Sources sheet is imported straight into the FRAC and recorded in `frac.uploads`, so that step uses the sheet
// instead of the AI (see the step files). A FRAC dictionary (a whole existing FRAC) does all three at once and
// keeps its mappings, so the steps update it rather than build a new one. Also serves the upload templates.
// Called by controllers/document.controller.ts; wired in server.ts. The uploaded file itself is never stored.
import { randomUUID } from "node:crypto";
import type { DocumentKind, DocumentSummary, FracDocument, SheetCheck } from "../models/document.model.ts";
import type { Frac, FracCompetency, SheetKind } from "../models/frac.model.ts";
import type { Repositories } from "../repositories/index.ts";
import { DOCUMENTS } from "../config/constants.ts";
import { badRequest, conflict, notFound } from "../utils/response.ts";
import { buildTemplateWorkbook } from "./excel/workbook-writer.ts";
import { readCsv } from "./excel/csv-reader.ts";
import { readWorkbook } from "./excel/workbook-reader.ts";
import { extractDocumentText } from "./documents/extract-text.ts";
import { importCompetenciesSheet, importDictionary, importRolesSheet, importSourcesSheet, type DictionaryImport, type RolesImport } from "./documents/import-sheets.ts";
import { BRIEF_GUIDE, DICTIONARY_FRAC_FORMAT, SHEET_FORMATS } from "./documents/sheet-formats.ts";
import type { SheetData } from "./review-engine/parse-workbook.ts";
import { jobRunning } from "./queue/job-runner.ts";
import type { FracService } from "./frac.service.ts";
import { markChecked, stampChanges } from "./step-changes.ts";
import { loadReviewRules } from "../config/review-rules.ts";
import { computeChecks, TITLES } from "./review-engine/checks.ts";
import { fracToModel } from "./review-engine/convert.ts";
import { normalizeCode } from "./review-engine/refs.ts";
import type { ReviewRules } from "./review-engine/rules.ts";
import { assertZipSafe } from "./documents/zip-guard.ts";

/** What the portal lists for a document: everything except the extracted text. */
export type DocumentInfo = Omit<FracDocument, "text" | "ownerId"> & { chars: number };

/** An uploaded file as multer hands it over. */
export interface UploadedFile {
  name: string;
  buffer: Buffer;
  mime: string;
}

const SHEET_EXTENSIONS = /\.(xlsx|csv)$/i;
const SHEET_LABELS: Record<Exclude<DocumentKind, "brief">, string> = {
  roles: "Roles", competencies: "Competencies", sources: "Sources", dictionary: "FRAC dictionary",
};

const info = ({ text, ownerId: _owner, ...rest }: FracDocument): DocumentInfo => ({ ...rest, chars: text.length });

/** An .xlsx or .csv file as sheets; 400 FILE_TYPE_NOT_ALLOWED for anything else, FILE_UNREADABLE when it cannot be read. */
async function readSheets(file: UploadedFile): Promise<SheetData[]> {
  if (!SHEET_EXTENSIONS.test(file.name)) throw badRequest("FILE_TYPE_NOT_ALLOWED", "Upload the sheet as .xlsx or .csv");
  if (/\.csv$/i.test(file.name)) return readCsv(file.buffer, file.name);
  assertZipSafe(file.buffer, file.name);
  try {
    return await readWorkbook(file.buffer);
  } catch {
    throw badRequest("FILE_UNREADABLE", `Could not read ${file.name}. Save it again as .xlsx and upload it.`);
  }
}

/** The uploads without the dictionary mark: a Roles or Competencies sheet uploaded later replaces the dictionary. */
function withoutDictionary(uploads: Frac["uploads"]): Frac["uploads"] {
  const rest = { ...uploads };
  delete rest.dictionary;
  return rest;
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
    uploads: { ...withoutDictionary(frac.uploads), roles: filename },
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
    uploads: { ...withoutDictionary(frac.uploads), competencies: filename },
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

/**
 * A FRAC dictionary replaces the roles, activities, postings (when it has any) and competencies, keeping its
 * activity → competency mappings, and the research sources when it has a Sources sheet and research exists. It is
 * recorded as the Roles, Competencies (and Sources) upload, so those steps keep it and only fill gaps: the Roles step
 * writes activities for empty roles, the Competencies step maps unmapped activities, and ladders are written only where
 * missing. rolesDirty is set only when some activity has no competency.
 */
export function applyDictionaryImport(frac: Frac, imported: Pick<DictionaryImport, "roles" | "postings" | "competencies" | "sources" | "prefix">, filename: string): Frac {
  const withSources = imported.sources.length > 0;
  return {
    ...frac,
    roles: imported.roles,
    postings: imported.postings.length ? imported.postings : frac.postings,
    competencies: imported.competencies,
    codePrefix: imported.prefix || frac.codePrefix,
    research: withSources && frac.research ? { ...frac.research, sources: imported.sources } : frac.research,
    rolesDirty: imported.roles.some((r) => r.activities.some((a) => !a.comp)),
    reviewStale: frac.review ? true : frac.reviewStale,
    uploads: { ...frac.uploads, dictionary: filename, roles: filename, competencies: filename, ...(withSources ? { sources: filename } : {}) },
  };
}

const SEVERITY_ORDER = { B: 0, M: 1, m: 2 } as const;

/**
 * The expert check's rule-based findings (computeChecks, no AI) that point at a just-imported sheet: for a Roles sheet
 * the ones naming its roles or activities, for a Competencies sheet the ones naming its competencies plus the
 * coverage gaps. Worst first. Lets the team fix the sheet before steps build on it. Coverage is about the competencies,
 * so it never shows on a Roles sheet. Mapping findings (activities not mapped, competencies never used) are left out:
 * a sheet replaces the mappings, and the roles or Competencies step maps the activities afterwards.
 */
export function sheetChecks(frac: Frac, kind: SheetKind, rules: ReviewRules): SheetCheck[] {
  if (kind === "sources") return [];
  const codes = new Set(kind === "roles"
    ? frac.roles.flatMap((r) => [r.code, ...r.activities.map((a) => a.code)]).map(normalizeCode)
    : frac.competencies.map((c) => normalizeCode(c.code)));
  if (!codes.size) return [];
  const named = (ref: string) => codes.has(normalizeCode(ref.split("@")[0]));
  return computeChecks(fracToModel(frac), rules, { cadre: frac.cadre }).findings
    .filter((f) => f.title !== TITLES.unmapped && f.title !== TITLES.unused)
    .filter((f) => (kind === "roles" ? f.check !== "coverage" && f.refs.some(named) : f.check === "coverage" || f.refs.some(named)))
    .sort((a, b) => SEVERITY_ORDER[a.sev] - SEVERITY_ORDER[b.sev])
    .map(({ check, sev, title, detail, fix, refs }) => ({ check, sev, title, detail, fix, refs }));
}

/** A dictionary's rule-based findings: those about its roles and those about its competencies, once each, worst first. */
export function dictionaryChecks(frac: Frac, rules: ReviewRules): SheetCheck[] {
  const seen = new Set<string>();
  return [...sheetChecks(frac, "roles", rules), ...sheetChecks(frac, "competencies", rules)]
    .filter((c) => {
      const key = `${c.title}|${c.refs.join(",")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => SEVERITY_ORDER[a.sev] - SEVERITY_ORDER[b.sev]);
}

/** The FRAC with a stored sheet's rows applied again, or null when the document kept no rows (a brief, or an older upload). */
function storedImport(frac: Frac, doc: FracDocument): Frac | null {
  const p = doc.parsed;
  if (doc.kind === "roles" && p?.roles) return applyRolesImport(frac, { roles: p.roles, postings: p.postings ?? [], warnings: [] }, doc.filename);
  if (doc.kind === "competencies" && p?.competencies) return applyCompetenciesImport(frac, p.competencies, doc.filename);
  if (doc.kind === "sources" && p?.sources) return applySourcesImport(frac, p.sources, doc.filename);
  if (doc.kind === "dictionary" && p?.roles && p.competencies) {
    return applyDictionaryImport(frac, { roles: p.roles, postings: p.postings ?? [], competencies: p.competencies, sources: p.sources ?? [], prefix: p.prefix ?? "" }, doc.filename);
  }
  return null;
}

export class DocumentService {
  constructor(
    private readonly repos: Repositories,
    private readonly fracs: FracService,
    private readonly rules: () => ReviewRules = loadReviewRules,
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
    // Older records this upload makes obsolete: the same kind, and for a dictionary the sheets it replaces
    // (a Roles or Competencies sheet after a dictionary leaves its record: the rest of the FRAC may still come from it)
    let replaces: DocumentKind[] = [kind];
    if (kind === "dictionary") {
      const imported = importDictionary(sheets, file.name);
      next = applyDictionaryImport(frac, imported, file.name);
      const activities = imported.roles.reduce((n, r) => n + r.activities.length, 0);
      parsed = {
        counts: {
          roles: imported.roles.length, activities, postings: imported.postings.length,
          mapped: imported.roles.reduce((n, r) => n + r.activities.filter((a) => a.comp).length, 0),
          competencies: imported.competencies.length, ladders: imported.competencies.filter((c) => c.levels).length,
          sources: imported.sources.length,
        },
        warnings: imported.warnings, roles: imported.roles, postings: imported.postings, competencies: imported.competencies,
        sources: imported.sources, prefix: imported.prefix,
      };
      replaces = ["dictionary", "roles", "competencies", ...(imported.sources.length ? ["sources" as const] : [])];
    } else if (kind === "roles") {
      const imported = importRolesSheet(sheets);
      next = applyRolesImport(frac, imported, file.name);
      parsed = {
        counts: { roles: imported.roles.length, activities: imported.roles.reduce((n, r) => n + r.activities.length, 0), postings: imported.postings.length },
        warnings: imported.warnings, roles: imported.roles, postings: imported.postings,
      };
    } else if (kind === "competencies") {
      const imported = importCompetenciesSheet(sheets);
      next = applyCompetenciesImport(frac, imported.competencies, file.name);
      parsed = {
        counts: { competencies: imported.competencies.length, ladders: imported.competencies.filter((c) => c.levels).length },
        warnings: imported.warnings, competencies: imported.competencies,
      };
    } else {
      const imported = importSourcesSheet(sheets);
      next = applySourcesImport(frac, imported.sources, file.name);
      parsed = { counts: { sources: imported.sources.length }, warnings: imported.warnings, sources: imported.sources };
    }

    if (kind === "dictionary") parsed.checks = dictionaryChecks(next, this.rules());
    else if (kind !== "sources") parsed.checks = sheetChecks(next, kind, this.rules());
    await this.repos.fracs.snapshot(frac, `Before ${SHEET_LABELS[kind]} sheet upload`);
    const at = new Date().toISOString();
    next = stampChanges(frac, { ...next, updatedAt: at }, at);
    await this.repos.fracs.update(next);
    for (const old of existing.filter((d) => replaces.includes(d.kind))) await this.repos.documents.delete(fracId, old.id);
    const doc: FracDocument = { ...base, text: "", parsed };
    await this.repos.documents.insert(doc);
    return { document: info(doc), frac: next };
  }

  /**
   * Puts an uploaded sheet's rows back on the FRAC (the Re-apply button), replacing edits made since the upload.
   * Snapshotted first, so it can be undone from History. 404 when the document is not this FRAC's, 409
   * SHEET_NOT_STORED for a brief document or a sheet uploaded before the rows were kept, 409 JOB_RUNNING while a
   * step runs.
   */
  async reapply(ownerId: string, fracId: string, documentId: string): Promise<Frac> {
    const frac = await this.fracs.get(ownerId, fracId);
    const active = await this.repos.jobs.activeFor(fracId);
    if (active) throw jobRunning(active);
    const doc = (await this.repos.documents.listForFrac(fracId)).find((d) => d.id === documentId);
    if (!doc) throw notFound("Document");
    const stored = storedImport(frac, doc);
    if (!stored || doc.kind === "brief") throw conflict("SHEET_NOT_STORED", "This sheet was uploaded before re-apply was possible. Upload it again to re-apply it.");

    await this.repos.fracs.snapshot(frac, `Before re-applying the ${SHEET_LABELS[doc.kind]} sheet`);
    const at = new Date().toISOString();
    const next = stampChanges(frac, { ...stored, updatedAt: at }, at);
    await this.repos.fracs.update(next);
    return next;
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
    // A dictionary was recorded as the Roles, Competencies and Sources upload; only the ones still pointing at it are cleared
    const kinds: (SheetKind | "dictionary")[] = doc.kind === "dictionary"
      ? (["dictionary", "roles", "competencies", "sources"] as const).filter((k) => frac.uploads?.[k] === doc.filename)
      : frac.uploads?.[doc.kind] ? [doc.kind] : [];
    if (!kinds.length) return frac;
    const uploads = { ...frac.uploads };
    for (const k of kinds) delete uploads[k];
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
    // A dictionary is the three sheets in one workbook, the same layout as a Creator download
    const formats = kind === "dictionary" ? [DICTIONARY_FRAC_FORMAT, SHEET_FORMATS.competencies, SHEET_FORMATS.sources] : [SHEET_FORMATS[kind]];
    return { buffer: await buildTemplateWorkbook(formats), filename: `FRAC Studio - ${SHEET_LABELS[kind]} template.xlsx`, type: "xlsx" };
  }
}
