import { dominantPrefix, normalizeCode, parseRefs } from "./refs.ts";
import type { Level } from "../../models/frac.model.ts";
import type { ModelActivity, ModelCompetency, ModelRole, ReviewModel } from "../../models/review.model.ts";

/** Reader-agnostic sheet: every cell already flattened to trimmed text. */
export interface SheetData {
  name: string;
  rows: string[][];
}

export class WorkbookParseError extends Error {}

export const NO_COMPETENCY_SHEET =
  'Could not find a competency sheet. It needs a header row with "Competency Code" and "Level 1" columns.';
export const NO_FRAC_SHEET_WARNING = "No FRAC sheet found: structure and coverage checks will be limited.";

const HEADER_SCAN_ROWS = 12;
const HINDI_SHEET = /\(H\)|hindi/i;
const COMP_CODE = /competenc.*code|^code$/;
const LEVEL_1 = /level\s*1/;
const ROLE = /^role/;
const ACTIVITY = /^activit/;
const MAPPING = /compe?t|mapping/;
const NOT_POSTING = /source|tier|applicab|note/;

interface HeaderHit {
  sheet: SheetData;
  headerRow: number;
  headers: string[];
}

function findHeader(sheets: SheetData[], ...required: RegExp[]): HeaderHit | null {
  for (const sheet of sheets) {
    const limit = Math.min(sheet.rows.length, HEADER_SCAN_ROWS);
    for (let r = 0; r < limit; r++) {
      const headers = sheet.rows[r].map((c) => (c ?? "").trim().toLowerCase());
      if (required.every((re) => headers.some((h) => re.test(h)))) return { sheet, headerRow: r, headers };
    }
  }
  return null;
}

/** First column whose header matches `re` and none of `exclude`. */
function col(headers: string[], re: RegExp, exclude?: RegExp): number {
  return headers.findIndex((h) => h !== "" && re.test(h) && !(exclude && exclude.test(h)));
}

function cell(row: string[], idx: number): string {
  return idx >= 0 ? (row[idx] ?? "").trim() : "";
}

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

  const out: ModelCompetency[] = [];
  for (const row of hit.sheet.rows.slice(hit.headerRow + 1)) {
    const code = cell(row, idx.code);
    if (!code) continue;
    const levels: Level[] = levelCols.map((lc) => ({ label: cell(row, lc.label), desc: cell(row, lc.desc) }));
    out.push({
      code: normalizeCode(code),
      label: cell(row, idx.label),
      description: cell(row, idx.desc),
      type: cell(row, idx.type),
      area: cell(row, idx.area),
      kcm: cell(row, idx.kcm) || undefined,
      levels,
    });
  }
  return out;
}

function parseFrac(hit: HeaderHit, prefix: string): Pick<ReviewModel, "postings" | "postingLabels" | "roles"> {
  const h = hit.headers;
  const roleCol = col(h, ROLE);
  const actCol = col(h, ACTIVITY);
  const mapCol = col(h, MAPPING);
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
  return { postings, postingLabels, roles };
}

export interface ParsedWorkbook {
  model: ReviewModel;
  warnings: string[];
}

/** Spec 6.1. Throws WorkbookParseError when no competency sheet can be found. */
export function parseWorkbook(sheets: SheetData[], title: string): ParsedWorkbook {
  const usable = sheets.filter((s) => !HINDI_SHEET.test(s.name));
  const compHit = findHeader(usable, COMP_CODE, LEVEL_1);
  if (!compHit) throw new WorkbookParseError(NO_COMPETENCY_SHEET);

  const competencies = parseCompetencies(compHit);
  const prefix = dominantPrefix(competencies.map((c) => c.code));
  const fracHit = findHeader(
    usable.filter((s) => s !== compHit.sheet),
    ROLE,
    ACTIVITY,
  );

  const model: ReviewModel = {
    title,
    hasFrac: !!fracHit,
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
