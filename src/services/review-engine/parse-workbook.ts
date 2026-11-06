import { dominantPrefix, normalizeCode, parseRefs } from "./refs.ts";
import type { Level } from "../../models/frac.model.ts";
import type { ModelActivity, ModelCompetency, ModelRole, ReviewModel } from "../../models/review.model.ts";

// Parse step of the review flow (spec 6.1, rules r3 §2): turns an uploaded workbook, already flattened
// to text by excel/workbook-reader.ts, into the ReviewModel the checks, the AI checklist and the
// fingerprint all read. Called by ReviewService.startUploadReview. Sheets are found by their header
// row, not by name or position, because every state lays its FRAC out differently. Reads no config.

/** Reader-agnostic sheet: every cell already flattened to trimmed text. */
export interface SheetData {
  name: string;
  rows: string[][];
}

/** Thrown when the upload is not a FRAC; errorHandler turns it into a 400 with the message below. */
export class WorkbookParseError extends Error {}

export const NO_COMPETENCY_SHEET =
  'Could not find a competency sheet. It needs a header row with "Competency Code" and "Level 1" (or "Applicable Level" / "Theme 1") columns.';
export const NO_FRAC_SHEET_WARNING = "No FRAC sheet found: structure and coverage checks will be limited.";

/** Header rows and the "Position:" line are looked for only in a sheet's first 12 rows (rules r3 §2). */
const HEADER_SCAN_ROWS = 12;
// Hindi copies of the English sheets are skipped so each competency is read once (spec 11: Hindi is open)
const HINDI_SHEET = /\(H\)|hindi/i;
// Header patterns, tested on lower-cased, trimmed header cells (rules r3 §2)
const COMP_CODE = /competenc.*code|^code$/;
// Rules r3 §2: a competency sheet is either laddered (Level 1…) or KCM format (Applicable Level, Theme n)
const COMP_SHEET = /level\s*1|applicable level|theme\s*1/;
const ROLE = /^role/;
const ACTIVITY = /^activit/;
// The Meghalaya layout: one "Roles/Activities" column of R1/A1 codes plus a "Description" column
const ROLE_ACTIVITY = /role.*activit/;
const DESCRIPTION = /^desc/;
// The activity → competency mapping column; when absent, hasMapping is false (rules r3 §2, §4.6)
const MAPPING = /compe?t|mapping/;
// Every other FRAC column is a posting (Sub-Centre, PHC …) unless its header matches this (rules r3 §2)
const NOT_POSTING = /source|tier|applicab|note|desc/;
const POSITION = /^position\s*:\s*(.+)$/i;

interface HeaderHit {
  sheet: SheetData;
  headerRow: number;
  headers: string[];
}

/** The header row of `sheet` (first 12 rows) that has a column matching each of `required`. */
function headerIn(sheet: SheetData, ...required: RegExp[]): HeaderHit | null {
  const limit = Math.min(sheet.rows.length, HEADER_SCAN_ROWS);
  for (let r = 0; r < limit; r++) {
    const headers = sheet.rows[r].map((c) => (c ?? "").trim().toLowerCase());
    if (required.every((re) => headers.some((h) => re.test(h)))) return { sheet, headerRow: r, headers };
  }
  return null;
}

/** The first sheet in `sheets` with such a header row. */
function findHeader(sheets: SheetData[], ...required: RegExp[]): HeaderHit | null {
  for (const sheet of sheets) {
    const hit = headerIn(sheet, ...required);
    if (hit) return hit;
  }
  return null;
}

/** Rules r3 §2: "Position: ANM" in the first 12 rows of any sheet. */
function findPosition(sheets: SheetData[]): string | undefined {
  for (const sheet of sheets) {
    for (const row of sheet.rows.slice(0, HEADER_SCAN_ROWS)) {
      for (const value of row) {
        const m = POSITION.exec((value ?? "").trim());
        if (m) return m[1].trim();
      }
    }
  }
  return undefined;
}

/** A blank type cell takes the type from the sheet name (rules r3 §2). */
function typeFromSheet(name: string): string {
  if (/behaviou?r/i.test(name)) return "Behavioural";
  if (/function/i.test(name)) return "Functional";
  if (/domain/i.test(name)) return "Domain";
  return "";
}

/** First column whose header matches `re` and none of `exclude`. */
function col(headers: string[], re: RegExp, exclude?: RegExp): number {
  return headers.findIndex((h) => h !== "" && re.test(h) && !(exclude && exclude.test(h)));
}

function cell(row: string[], idx: number): string {
  return idx >= 0 ? (row[idx] ?? "").trim() : "";
}

/**
 * Reads one competency sheet. A laddered sheet gives five {label, desc} levels per row; a KCM-format sheet
 * gives `format: "kcm"`, themes and the applicable level, with no ladder (rules r3 §2). Rows with no code are skipped.
 */
function parseCompetencies(hit: HeaderHit): ModelCompetency[] {
  const h = hit.headers;
  // Label/description/type/area must not grab "Competency Level n …" columns (spec gap 8)
  const notLevel = /level/;
  const idx = {
    code: col(h, COMP_CODE, notLevel),
    label: col(h, /competenc.*label|^label$/, notLevel),
    desc: col(h, /competenc.*desc/, notLevel),
    type: col(h, /type/, notLevel),
    area: col(h, /area|subject/, notLevel),
    kcm: col(h, /kcm/),
  };
  const levelCols = [1, 2, 3, 4, 5].map((n) => {
    const labelCol = col(h, new RegExp(String.raw`level\s*${n}\b.*label`));
    return {
      // Some dictionaries have a bare "Level n" column holding the label
      label: labelCol >= 0 ? labelCol : col(h, new RegExp(String.raw`^level\s*${n}$`)),
      desc: col(h, new RegExp(String.raw`level\s*${n}\b.*desc`)),
    };
  });

  // KCM format: Applicable Level + Theme n columns and no Level n label (rules r3 §2)
  const applicable = col(h, /applicable level/);
  const themeCols = h.map((header, i) => (/theme\s*\d/.test(header) ? i : -1)).filter((i) => i >= 0);
  const kcmFormat = applicable >= 0 && themeCols.length > 0 && levelCols.every((lc) => lc.label < 0);
  const sheetType = typeFromSheet(hit.sheet.name);

  const out: ModelCompetency[] = [];
  for (const row of hit.sheet.rows.slice(hit.headerRow + 1)) {
    const code = cell(row, idx.code);
    if (!code) continue;
    const base = {
      code: normalizeCode(code),
      label: cell(row, idx.label),
      description: cell(row, idx.desc),
      type: cell(row, idx.type) || sheetType,
      area: cell(row, idx.area),
      kcm: cell(row, idx.kcm) || undefined,
    };
    if (kcmFormat) {
      out.push({
        ...base,
        format: "kcm",
        themes: themeCols.map((i) => cell(row, i)).filter(Boolean),
        applicableLevel: cell(row, applicable),
        levels: [],
      });
    } else {
      out.push({ ...base, levels: levelCols.map((lc): Level => ({ label: cell(row, lc.label), desc: cell(row, lc.desc) })) });
    }
  }
  return out;
}

/**
 * Reads the Role–Activity (FRAC) sheet. Rows run in order: a code starting with "R" (or a first row that
 * is not an activity) opens a role, and the rows under it are its activities. Missing codes get R{n}/A{n}.
 * `prefix` lets bare numbers in the mapping cell ("12, 14") become codes ("ANM12, ANM14").
 */
function parseFrac(hit: HeaderHit, prefix: string): Pick<ReviewModel, "postings" | "postingLabels" | "roles" | "hasMapping"> {
  const h = hit.headers;
  // Either Role + Activity columns, or one Roles/Activities code column with the text under Description
  const roleCol = col(h, ROLE);
  const activityCol = col(h, ACTIVITY);
  const actCol = activityCol >= 0 ? activityCol : col(h, DESCRIPTION);
  const mapCol = col(h, MAPPING, ROLE_ACTIVITY);
  const postingCols: number[] = [];
  h.forEach((header, i) => {
    if (header && i !== roleCol && i !== actCol && i !== mapCol && !NOT_POSTING.test(header)) postingCols.push(i);
  });
  const rawHeaders = hit.sheet.rows[hit.headerRow];
  const postings = postingCols.map((i) => (rawHeaders[i] ?? "").trim());
  // Creator exports write "P1: ANM at Sub-Centre"; keep just the label
  const postingLabels = postings.map((p) => p.replace(/^P\d+\s*:\s*/i, ""));

  const roles: ModelRole[] = [];
  let current: ModelRole | null = null;
  let actSeq = 0;
  for (const row of hit.sheet.rows.slice(hit.headerRow + 1)) {
    const code = cell(row, roleCol);
    const text = cell(row, actCol);
    if (!code && !text) continue;
    const upper = code.toUpperCase();
    const refs = parseRefs(cell(row, mapCol), prefix);

    if (upper.startsWith("R") || (!current && !upper.startsWith("A"))) {
      current = { code: code || `R${roles.length + 1}`, title: text, refs, activities: [] };
      roles.push(current);
      continue;
    }
    if (!current) {
      current = { code: "R1", title: "", refs: [], activities: [] };
      roles.push(current);
    }
    actSeq++;
    const activity: ModelActivity = {
      code: code || `A${actSeq}`,
      text,
      postings: Object.fromEntries(postingCols.map((c, k) => [postings[k], cell(row, c)])),
      refs,
    };
    current.activities.push(activity);
  }
  return { postings, postingLabels, roles, hasMapping: mapCol >= 0 };
}

export interface ParsedWorkbook {
  model: ReviewModel;
  warnings: string[];
}

/**
 * Spec 6.1, rules r3 §2. Reads every competency sheet and the first other sheet with Role + Activity (or
 * Roles/Activities + Description) headers. A missing FRAC sheet is a warning, not an error: the review
 * still runs and raises "No Role–Activity sheet". Throws WorkbookParseError when no competency sheet can be found.
 */
export function parseWorkbook(sheets: SheetData[], title: string): ParsedWorkbook {
  const usable = sheets.filter((s) => !HINDI_SHEET.test(s.name));
  // Every competency sheet, not just the first: files often split Domain, Functional and Behavioural
  const compHits = usable.map((s) => headerIn(s, COMP_CODE, COMP_SHEET)).filter((x): x is HeaderHit => x !== null);
  if (!compHits.length) throw new WorkbookParseError(NO_COMPETENCY_SHEET);

  const competencies = compHits.flatMap(parseCompetencies);
  const prefix = dominantPrefix(competencies.map((c) => c.code));
  const others = usable.filter((s) => !compHits.some((c) => c.sheet === s));
  const fracHit = findHeader(others, ROLE, ACTIVITY) ?? findHeader(others, ROLE_ACTIVITY, DESCRIPTION);

  const model: ReviewModel = {
    title,
    position: findPosition(usable),
    hasFrac: !!fracHit,
    hasMapping: false,
    postings: [],
    postingLabels: [],
    roles: [],
    competencies,
  };
  const warnings: string[] = [];
  if (fracHit) Object.assign(model, parseFrac(fracHit, prefix));
  else warnings.push(NO_FRAC_SHEET_WARNING);
  return { model, warnings };
}
