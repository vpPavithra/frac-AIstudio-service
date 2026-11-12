// Builds the Excel downloads: the Creator's FRAC workbook, the Reviewer's report workbook and the
// standard-sheet templates.
// Called by frac.service.ts and review.service.ts when the portal asks for an export. Returns an .xlsx
// Buffer and the download file name. Files go to outside experts, so AI personas are never named:
// each finding says only "Rule-based check" or "AI judgement (quoted)".
import ExcelJS from "exceljs";
import type { SheetFormat } from "../documents/sheet-formats.ts";
import { parseRefs } from "../review-engine/refs.ts";
import type { Finding, Report } from "../../models/report.model.ts";
import type { Frac } from "../../models/frac.model.ts";
import { TRIAGE_LABELS } from "../review-engine/report.ts";

// Header and role-row colours (ARGB) shared by every sheet.
const HEADER_FONT = { bold: true, color: { argb: "FF1F3B3E" } };
const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFB7DDE0" },
};
const ROLE_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9EDEF" },
};

/** Column headers of the findings table on the "Expert check" and "Review" sheets. */
const REPORT_HEADERS = ["Severity", "Check", "Finding", "Detail", "Refs", "Suggested fix", "Found by"];

/** Wraps and top-aligns every cell, then colours the given header rows and bolds the given role rows. */
function styleSheet(sheet: ExcelJS.Worksheet, headerRows: number[] = [], roleRows: number[] = []): void {
  sheet.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
    });
    if (headerRows.includes(rowNumber)) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = HEADER_FONT;
        cell.fill = HEADER_FILL;
      });
    }
    if (roleRows.includes(rowNumber)) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { bold: true };
        cell.fill = ROLE_FILL;
      });
    }
  });
}

/** Joins the distinct competency codes that a role's activities map to, for the role row of the FRAC sheet. */
function uniqueRoleCompetencyCodes(frac: Frac, activities: Frac["roles"][number]["activities"]): string {
  const refs = activities.flatMap((activity) => parseRefs(activity.comp, frac.codePrefix));
  return [...new Set(refs.map((ref) => ref.code))].join(", ");
}

/** Rules r3 §8: how the review was made, with the engine version and the file fingerprint. */
export function methodText(report: Report): string {
  const engine = report.engine ? `Review engine ${report.engine}` : "Review engine r1";
  const fingerprint = report.fingerprint ? ` · file fingerprint ${report.fingerprint.slice(0, 12)}` : "";
  return `Rule-based checks give the same result on every run. AI judgement covers only a fixed checklist (scope, clinical accuracy, state fit), and each AI finding quotes the file. ${engine}${fingerprint}.`;
}

/**
 * Rows of a report sheet: Verdict, Triage, Summary and Method label/value pairs, a blank row,
 * then the findings table (REPORT_HEADERS plus one row per finding).
 */
function reportRows(report: Report): ExcelJS.CellValue[][] {
  return [
    ["Verdict", report.verdict],
    ["Triage", TRIAGE_LABELS[report.triage]],
    ["Summary", report.summary],
    ["Method", methodText(report)],
    [],
    REPORT_HEADERS,
    ...report.findings.map((finding) => findingRow(finding)),
  ];
}

/** 1-based row of the findings header in `reportRows`, so styling follows the layout when rows are added above it. */
function reportHeaderRow(rows: ExcelJS.CellValue[][]): number {
  return rows.indexOf(REPORT_HEADERS) + 1;
}

/** One findings-table row. Severity codes B/M/m become BLOCKER/MAJOR/MINOR. */
function findingRow(finding: Finding): ExcelJS.CellValue[] {
  const severity = finding.sev === "B" ? "BLOCKER" : finding.sev === "M" ? "MAJOR" : "MINOR";
  return [
    severity,
    finding.check,
    finding.title,
    finding.detail,
    finding.refs.join(", "),
    finding.fix,
    // Files go to experts: never internal agent names (rules r3 §8)
    finding.source === "computed" ? "Rule-based check" : "AI judgement (quoted)",
  ];
}

/** Serialises the workbook to a Node Buffer for the HTTP response. */
async function finishWorkbook(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Builds the Creator download. Sheets:
 * - "FRAC": Role, Activity, one "Pn: label" column per posting, Tentative Competency Label, Source,
 *   Source tier. Each role row (shaded) lists its activities' distinct competency codes; activity rows follow.
 * - "Competencies": code, label, description, type, area, label and description for levels 1-5, KCM alignment.
 * - "Method & Sources": position, state, build date, method paragraph and the research notes as label/value
 *   rows, then a Title / Issuer / Year / Use / Tier / URL table of sources.
 * - "Expert check" (only when the FRAC has a review that is not out of date): the same rows as the Reviewer's
 *   "Review" sheet. The "Built" row says whether the file was expert-checked.
 * The caller passes the method paragraph so the prototype's verbatim text is used, never invented here.
 */
export async function buildFracWorkbook(frac: Frac, methodParagraph: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "FRAC Studio";

  const fracSheet = workbook.addWorksheet("FRAC");
  const postingHeaders = frac.postings.map((posting, index) => `P${index + 1}: ${posting.label}`);
  const fracHeaders = ["Role", "Activity", ...postingHeaders, "Tentative Competency Label", "Source", "Source tier"];
  fracSheet.addRow(fracHeaders);
  const roleRowNumbers: number[] = [];

  for (const role of frac.roles) {
    const roleRow = fracSheet.addRow([
      role.code,
      role.title,
      ...frac.postings.map(() => ""),
      uniqueRoleCompetencyCodes(frac, role.activities),
      role.source,
      "",
    ]);
    roleRowNumbers.push(roleRow.number);

    for (const activity of role.activities) {
      fracSheet.addRow([
        activity.code,
        activity.text,
        ...frac.postings.map((posting) => activity.postings[posting.key] ?? ""),
        activity.comp,
        activity.source,
        activity.tier,
      ]);
    }
  }
  styleSheet(fracSheet, [1], roleRowNumbers);

  const competencySheet = workbook.addWorksheet("Competencies");
  competencySheet.addRow([
    "Competency Code",
    "Competency Label",
    "Competency Description",
    "Competency Type",
    "Competency Area (PH/Digital/Data literacy)",
    ...[1, 2, 3, 4, 5].flatMap((level) => [
      `Competency Level ${level} Label`,
      `Competency Level ${level} Description`,
    ]),
    "KCM Alignment (CBC Karmayogi Competency Model)",
  ]);
  for (const competency of frac.competencies) {
    const levels = Array.from({ length: 5 }, (_, index) => {
      const level = competency.levels?.[index];
      return [level?.label ?? "", level?.desc ?? ""];
    }).flat();
    competencySheet.addRow([
      competency.code,
      competency.label,
      competency.description,
      competency.type,
      competency.area,
      ...levels,
      competency.kcm,
    ]);
  }
  styleSheet(competencySheet, [1]);

  const sourceSheet = workbook.addWorksheet("Method & Sources");
  sourceSheet.addRow(["FRAC Studio"]);
  sourceSheet.addRow(["Position", frac.cadreFull || frac.cadre]);
  sourceSheet.addRow(["State", frac.state]);
  // A download before the expert check, or after edits that put it out of date, says so
  const checked = !!frac.review && !frac.reviewStale;
  sourceSheet.addRow(["Built", `Built ${frac.updatedAt.slice(0, 10)} in FRAC Studio (AI Studio) — ${checked ? "expert-checked; " : "not yet expert-checked; "}draft for expert validation`]);
  sourceSheet.addRow(["Method", methodParagraph]);
  sourceSheet.addRow(["Job summary", frac.research?.summary ?? ""]);
  sourceSheet.addRow(["Source notes", frac.research?.sourceNotes ?? ""]);
  sourceSheet.addRow(["Postings", frac.postings.map((posting) => `${posting.key}: ${posting.label}`).join("\n")]);
  sourceSheet.addRow(["Authorised scope", frac.research?.authorised ?? ""]);
  sourceSheet.addRow(["Not authorised / refer", frac.research?.notAuthorised ?? ""]);
  sourceSheet.addRow(["State context", frac.research?.stateContext ?? ""]);
  sourceSheet.addRow(["Assumptions & to verify", frac.research?.assumptions ?? ""]);
  sourceSheet.addRow([]);
  const sourceHeaderRow = sourceSheet.rowCount + 1;
  sourceSheet.addRow(["Title", "Issuer", "Year", "Use", "Tier", "URL"]);
  for (const source of frac.research?.sources ?? []) {
    sourceSheet.addRow([source.title, source.issuer, source.year, source.use, source.tier, source.url ?? ""]);
  }
  styleSheet(sourceSheet, [sourceHeaderRow]);

  // An out-of-date check is left out, so a draft never shows findings that may already be fixed
  if (frac.review && checked) {
    const reviewSheet = workbook.addWorksheet("Expert check");
    const rows = reportRows(frac.review);
    rows.forEach((row) => reviewSheet.addRow(row));
    styleSheet(reviewSheet, [reportHeaderRow(rows)]);
  }

  return finishWorkbook(workbook);
}

/**
 * A standard-sheet template (documents/sheet-formats.ts): the sheet with its header row and example rows,
 * then an "Instructions" sheet with one row per column and the notes. The importer reads the same headers.
 */
export async function buildTemplateWorkbook(format: SheetFormat): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "FRAC Studio";
  const sheet = workbook.addWorksheet(format.sheet);
  sheet.addRow(format.columns.map((c) => c.header));
  format.example.forEach((row) => sheet.addRow(row));
  sheet.columns.forEach((column) => {
    column.width = 28;
  });
  styleSheet(sheet, [1]);

  const help = workbook.addWorksheet("Instructions");
  help.addRow(["Column", "What to write"]);
  format.columns.forEach((c) => help.addRow([c.header, c.help]));
  help.addRow([]);
  format.notes.forEach((note) => help.addRow(["Note", note]));
  help.addRow(["Note", "Replace the example rows with your own. Keep the header row as it is."]);
  help.getColumn(1).width = 40;
  help.getColumn(2).width = 90;
  styleSheet(help, [1]);
  return finishWorkbook(workbook);
}

/**
 * Builds the Reviewer download: one "Review" sheet with Verdict, Triage, Summary and Method,
 * then the findings table (Severity, Check, Finding, Detail, Refs, Suggested fix, Found by).
 */
export async function buildReviewWorkbook(report: Report): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "FRAC Studio";
  const sheet = workbook.addWorksheet("Review");
  const rows = reportRows(report);
  rows.forEach((row) => sheet.addRow(row));
  styleSheet(sheet, [reportHeaderRow(rows)]);
  return finishWorkbook(workbook);
}

/** Returns the Creator download name: "<cadre> competencies - <state>.xlsx". */
export function fracWorkbookFilename(frac: Pick<Frac, "cadre" | "state">): string {
  return `${safeFilename(frac.cadre)} competencies - ${safeFilename(frac.state)}.xlsx`;
}

/** Returns the Reviewer download name: "FRAC review - <title>.xlsx". */
export function reviewWorkbookFilename(title: string): string {
  return `FRAC review - ${safeFilename(title)}.xlsx`;
}

/** Replaces characters Windows forbids in file names and trims dots/dashes; falls back to "FRAC" if empty. */
function safeFilename(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.-]+|[.-]+$/g, "") || "FRAC";
}
