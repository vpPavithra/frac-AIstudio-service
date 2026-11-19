// Reads the standard sheets a team uploads in place of an AI step (review decisions, Nov 2026): Roles with
// activities, Competencies with optional ladders, and Sources; and a FRAC dictionary, all three in one workbook. Input is SheetData from the workbook or CSV
// reader; sheets are found by their header row (sheet-formats.ts gives the layouts), reusing the Reviewer's
// header helpers and competency reader. Pure: DocumentService applies the result to the FRAC.
import { LIMITS } from "../../config/constants.ts";
import type { FracCompetency, FracRole, FracSource, Posting } from "../../models/frac.model.ts";
import {
  ACTIVITY,
  cell,
  parseWorkbook,
  WorkbookParseError,
  col,
  COMP_CODE,
  COMP_SHEET,
  HINDI_SHEET,
  headerIn,
  MAPPING,
  NOT_POSTING,
  parseCompetencies,
  ROLE,
  type SheetData,
} from "../review-engine/parse-workbook.ts";
import { badRequest } from "../../utils/response.ts";
import { dominantPrefix, formatRefs } from "../review-engine/refs.ts";
import { renumberRoles } from "../ai/roles.step.ts";
import { SOURCE_TIERS } from "./sheet-formats.ts";

/** A safety limit on posting columns (LIMITS.maxPostings); a sheet normally has far fewer. */
const MAX_POSTINGS = LIMITS.maxPostings;
const TEMPLATE_HINT = "Download the template to see the expected columns.";

export interface RolesImport {
  roles: FracRole[];
  postings: Posting[];
  warnings: string[];
}

export interface CompetenciesImport {
  competencies: FracCompetency[];
  warnings: string[];
}

export interface SourcesImport {
  sources: FracSource[];
  warnings: string[];
}

export interface DictionaryImport {
  roles: FracRole[];
  postings: Posting[];
  competencies: FracCompetency[];
  /** From a Sources sheet in the same file (a Creator download has one); empty when it has none. */
  sources: FracSource[];
  /** The competency code prefix most codes share (e.g. "GNM"); "" when there is none. */
  prefix: string;
  warnings: string[];
}

const usable = (sheets: SheetData[]) => sheets.filter((s) => !HINDI_SHEET.test(s.name));

/** "Yes"/"No" from the usual ways of writing them; anything else is left blank for the team to decide. */
function yesNo(value: string): string {
  const v = value.trim().toLowerCase();
  if (["yes", "y", "✓", "1", "true"].includes(v)) return "Yes";
  if (["no", "n", "✗", "0", "false"].includes(v)) return "No";
  return "";
}

/** A known source tier in its canonical spelling, else the value as typed. */
function tierOf(value: string): string {
  const v = value.trim();
  return SOURCE_TIERS.find((t) => t.toLowerCase() === v.toLowerCase()) ?? (/^inferred/i.test(v) ? "Inferred – verify" : v);
}

/**
 * A Roles sheet: role rows ("R1" in the Role column) each followed by their activity rows ("A1"), as in the
 * Creator's FRAC sheet. Posting columns ("P1: …") become the FRAC's postings, at most 3. Codes are renumbered
 * R1..Rn, A1..An; competency references are not imported (the Competencies step maps them).
 * Throws 400 SHEET_NOT_RECOGNISED when no sheet has Role and Activity headers, or it has no roles.
 */
export function importRolesSheet(sheets: SheetData[]): RolesImport {
  const hit = usable(sheets).map((s) => headerIn(s, ROLE, ACTIVITY)).find((h) => h !== null);
  if (!hit) throw badRequest("SHEET_NOT_RECOGNISED", `Could not find a roles sheet. It needs a header row with "Role" and "Activity" columns. ${TEMPLATE_HINT}`);
  const h = hit.headers;
  const roleCol = col(h, ROLE);
  const actCol = col(h, ACTIVITY);
  const sourceCol = col(h, /^source$/);
  const tierCol = col(h, /tier/);
  const mapCol = col(h, MAPPING);
  const postingCols: number[] = [];
  h.forEach((header, i) => {
    if (header && i !== roleCol && i !== actCol && i !== mapCol && !NOT_POSTING.test(header)) postingCols.push(i);
  });

  const warnings: string[] = [];
  if (postingCols.length > MAX_POSTINGS) warnings.push(`Only the first ${MAX_POSTINGS} posting columns were kept.`);
  const kept = postingCols.slice(0, MAX_POSTINGS);
  const rawHeaders = hit.sheet.rows[hit.headerRow];
  // Creator exports and the template write "P1: ANM at Sub-Centre"; keep just the label
  const postings = kept.map((c, k) => ({ key: `P${k + 1}`, label: (rawHeaders[c] ?? "").trim().replace(/^P\d+\s*:\s*/i, "") }));

  const roles: FracRole[] = [];
  let current: FracRole | null = null;
  for (const row of hit.sheet.rows.slice(hit.headerRow + 1)) {
    const code = cell(row, roleCol).toUpperCase();
    const text = cell(row, actCol);
    if (!code && !text) continue;
    if (code.startsWith("R") || (!current && !code.startsWith("A"))) {
      current = { code: "", title: text, source: cell(row, sourceCol), activities: [] };
      roles.push(current);
      continue;
    }
    if (!text) continue;
    if (!current) {
      current = { code: "", title: "", source: "", activities: [] };
      roles.push(current);
    }
    current.activities.push({
      code: "",
      text,
      postings: Object.fromEntries(kept.map((c, k) => [`P${k + 1}`, yesNo(cell(row, c))])),
      source: cell(row, sourceCol),
      tier: tierOf(cell(row, tierCol)),
      comp: "",
    });
  }
  if (!roles.length) throw badRequest("SHEET_NOT_RECOGNISED", `The roles sheet has no role rows. ${TEMPLATE_HINT}`);
  const untitled = roles.filter((r) => !r.title).length;
  if (untitled) warnings.push(`${untitled} role row(s) have no title; add one in Roles & activities.`);
  const empty = roles.filter((r) => !r.activities.length).length;
  if (empty) warnings.push(`${empty} role(s) have no activities; the Roles step will write them.`);
  return { roles: renumberRoles(roles), postings, warnings };
}

/**
 * A Competencies sheet (every sheet with "Competency Code" and "Level 1"/"Applicable Level" headers, as the
 * Reviewer reads them). A ladder is kept only when all five level labels are filled; otherwise `levels` is
 * null and the Level ladders step writes it. A repeated code keeps its first row.
 * Throws 400 SHEET_NOT_RECOGNISED when no competency sheet is found or it has no codes.
 */
export function importCompetenciesSheet(sheets: SheetData[]): CompetenciesImport {
  const hits = usable(sheets).map((s) => headerIn(s, COMP_CODE, COMP_SHEET)).filter((h) => h !== null);
  if (!hits.length) {
    throw badRequest("SHEET_NOT_RECOGNISED", `Could not find a competency sheet. It needs a header row with "Competency Code" and "Competency Level 1 Label" columns. ${TEMPLATE_HINT}`);
  }
  const warnings: string[] = [];
  const seen = new Set<string>();
  const competencies: FracCompetency[] = [];
  for (const c of hits.flatMap(parseCompetencies)) {
    if (seen.has(c.code)) {
      warnings.push(`Competency ${c.code} appears more than once; the first row was kept.`);
      continue;
    }
    seen.add(c.code);
    const full = c.format !== "kcm" && c.levels.length === 5 && c.levels.every((l) => l.label.trim());
    competencies.push({ code: c.code, label: c.label, description: c.description, type: c.type, area: c.area, kcm: c.kcm ?? "", levels: full ? c.levels : null });
  }
  if (!competencies.length) throw badRequest("SHEET_NOT_RECOGNISED", `The competency sheet has no competency codes. ${TEMPLATE_HINT}`);
  const unlabelled = competencies.filter((c) => !c.label).length;
  if (unlabelled) warnings.push(`${unlabelled} competencies have no label.`);
  return { competencies, warnings };
}

/**
 * A Sources sheet: a header row with Title and Issuer anywhere in the sheet (the Creator download's
 * "Method & Sources" table sits below the notes), then one source per row. A link that is not http(s) is dropped.
 * Throws 400 SHEET_NOT_RECOGNISED when no such header row exists or it has no titles.
 */
export function importSourcesSheet(sheets: SheetData[]): SourcesImport {
  let found: { sheet: SheetData; row: number; headers: string[] } | null = null;
  for (const sheet of usable(sheets)) {
    const row = sheet.rows.findIndex((r) => {
      const hs = r.map((c) => (c ?? "").trim().toLowerCase());
      return hs.includes("title") && hs.includes("issuer");
    });
    if (row >= 0) {
      found = { sheet, row, headers: sheet.rows[row].map((c) => (c ?? "").trim().toLowerCase()) };
      break;
    }
  }
  if (!found) throw badRequest("SHEET_NOT_RECOGNISED", `Could not find a sources sheet. It needs a header row with "Title" and "Issuer" columns. ${TEMPLATE_HINT}`);
  const h = found.headers;
  const idx = { title: col(h, /^title$/), issuer: col(h, /^issuer$/), year: col(h, /^year/), use: col(h, /^use/), tier: col(h, /tier/), url: col(h, /url|link/) };
  const warnings: string[] = [];
  const sources: FracSource[] = [];
  for (const row of found.sheet.rows.slice(found.row + 1)) {
    const title = cell(row, idx.title);
    if (!title) continue;
    const link = cell(row, idx.url);
    const url = /^https?:\/\//i.test(link) ? link : "";
    if (link && !url) warnings.push(`The link for "${title}" is not a web address and was left out.`);
    sources.push({ title, issuer: cell(row, idx.issuer), year: cell(row, idx.year), use: cell(row, idx.use), tier: tierOf(cell(row, idx.tier)), ...(url ? { url } : {}) });
  }
  if (!sources.length) throw badRequest("SHEET_NOT_RECOGNISED", `The sources sheet has no rows with a title. ${TEMPLATE_HINT}`);
  return { sources, warnings };
}

/**
 * A FRAC dictionary: a whole FRAC in one workbook, as the Reviewer reads it (parseWorkbook): the Role–Activity sheet
 * with its posting columns and competency mappings, every competency sheet (ladders kept where all five level labels
 * are filled), and a Sources sheet when the file has one (a Creator download). Codes of roles and activities are
 * renumbered; competency codes and the mappings to them are kept as written.
 * Throws 400 SHEET_NOT_RECOGNISED when there is no competency sheet or no Role–Activity sheet (a competencies-only
 * file belongs in the Competencies slot).
 */
export function importDictionary(sheets: SheetData[], filename: string): DictionaryImport {
  let parsed: ReturnType<typeof parseWorkbook>;
  try {
    parsed = parseWorkbook(sheets, filename);
  } catch (err) {
    if (err instanceof WorkbookParseError) {
      throw badRequest("SHEET_NOT_RECOGNISED", `Could not find the competencies in this FRAC dictionary. It needs a competency sheet with "Competency Code" and "Competency Level 1 Label" columns. ${TEMPLATE_HINT}`);
    }
    throw err;
  }
  const { model } = parsed;
  if (!model.hasFrac || !model.roles.length) {
    throw badRequest("SHEET_NOT_RECOGNISED", "This file has competencies but no roles and activities sheet. Upload it as a Competency sheet instead, or add the FRAC sheet with \"Role\" and \"Activity\" columns.");
  }

  const warnings = [...parsed.warnings];
  if (model.postings.length > MAX_POSTINGS) warnings.push(`Only the first ${MAX_POSTINGS} posting columns were kept.`);
  const keptPostings = model.postings.slice(0, MAX_POSTINGS);
  const postings = keptPostings.map((p, i) => ({ key: `P${i + 1}`, label: (model.postingLabels[i] || p).replace(/^P\d+\s*:\s*/i, "") }));
  const keyOf = new Map(keptPostings.map((p, i) => [p, `P${i + 1}`]));

  const roles: FracRole[] = model.roles.map((r) => ({
    code: "",
    title: r.title,
    source: "",
    activities: r.activities.map((a) => ({
      code: "",
      text: a.text,
      postings: Object.fromEntries(Object.entries(a.postings).filter(([header]) => keyOf.has(header)).map(([header, v]) => [keyOf.get(header) as string, yesNo(v)])),
      source: "",
      tier: "",
      comp: formatRefs(a.refs),
    })),
  }));

  const seen = new Set<string>();
  const competencies: FracCompetency[] = [];
  for (const c of model.competencies) {
    if (seen.has(c.code)) {
      warnings.push(`Competency ${c.code} appears more than once; the first row was kept.`);
      continue;
    }
    seen.add(c.code);
    const full = c.format !== "kcm" && c.levels.length === 5 && c.levels.every((l) => l.label.trim());
    competencies.push({ code: c.code, label: c.label, description: c.description, type: c.type, area: c.area, kcm: c.kcm ?? "", levels: full ? c.levels : null });
  }

  const unknown = new Set(roles.flatMap((r) => r.activities.flatMap((a) => a.comp.split(",").map((x) => x.split("@")[0].trim()).filter(Boolean)))
    .filter((code) => !seen.has(code)));
  if (unknown.size) warnings.push(`${unknown.size} competency code(s) used in the FRAC sheet are not in the competency sheet: ${[...unknown].slice(0, 5).join(", ")}${unknown.size > 5 ? "…" : ""}.`);
  const unmapped = roles.reduce((n, r) => n + r.activities.filter((a) => !a.comp).length, 0);
  if (unmapped) warnings.push(`${unmapped} activit${unmapped === 1 ? "y has" : "ies have"} no competency; Map activities fills them in.`);

  let sources: FracSource[] = [];
  try {
    sources = importSourcesSheet(sheets).sources;
  } catch {
    // A dictionary without a Sources sheet is normal; research finds the sources
  }
  return { roles: renumberRoles(roles), postings, competencies, sources, prefix: dominantPrefix(competencies.map((c) => c.code)), warnings };
}
