import ExcelJS from "exceljs";
import { parseRefs } from "../review-engine/refs.ts";
import type { Finding, Report } from "../../models/report.model.ts";
import type { Frac } from "../../models/frac.model.ts";
import { TRIAGE_LABELS } from "../review-engine/report.ts";

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

const REPORT_HEADERS = ["Severity", "Check", "Finding", "Detail", "Refs", "Suggested fix", "Found by"];

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

function uniqueRoleCompetencyCodes(frac: Frac, activities: Frac["roles"][number]["activities"]): string {
  const refs = activities.flatMap((activity) => parseRefs(activity.comp, frac.codePrefix));
  return [...new Set(refs.map((ref) => ref.code))].join(", ");
}

function reportRows(report: Report): ExcelJS.CellValue[][] {
  return [
    ["Verdict", report.verdict],
    ["Triage", TRIAGE_LABELS[report.triage]],
    ["Summary", report.summary],
    [],
    REPORT_HEADERS,
    ...report.findings.map((finding) => findingRow(finding)),
  ];
}

function findingRow(finding: Finding): ExcelJS.CellValue[] {
  const severity = finding.sev === "B" ? "BLOCKER" : finding.sev === "M" ? "MAJOR" : "MINOR";
  return [
    severity,
    finding.check,
    finding.title,
    finding.detail,
    finding.refs.join(", "),
    finding.fix,
    finding.source === "computed" ? "Computed check" : "Kaushal & Vidya",
  ];
}

async function finishWorkbook(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Builds the Creator workbook with FRAC, competency, method/source and optional expert-check sheets.
 * The method paragraph is required from the caller so the prototype's verbatim text is not invented.
 * Side effects: creates an in-memory Excel workbook.
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
  sourceSheet.addRow(["Cadre", frac.cadreFull || frac.cadre]);
  sourceSheet.addRow(["State", frac.state]);
  sourceSheet.addRow(["Built", `Built ${frac.updatedAt.slice(0, 10)} in FRAC Studio (AI Studio) — draft for expert validation`]);
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
  sourceSheet.addRow(["Title", "Issuer", "Year", "Use", "Tier"]);
  for (const source of frac.research?.sources ?? []) {
    sourceSheet.addRow([source.title, source.issuer, source.year, source.use, source.tier]);
  }
  styleSheet(sourceSheet, [sourceHeaderRow]);

  if (frac.review) {
    const reviewSheet = workbook.addWorksheet("Expert check");
    const rows = reportRows(frac.review);
    rows.forEach((row) => reviewSheet.addRow(row));
    styleSheet(reviewSheet, [5]);
  }

  return finishWorkbook(workbook);
}

/** Builds the single-sheet Excel download for a Reviewer report. */
export async function buildReviewWorkbook(report: Report): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "FRAC Studio";
  const sheet = workbook.addWorksheet("Review");
  reportRows(report).forEach((row) => sheet.addRow(row));
  styleSheet(sheet, [5]);
  return finishWorkbook(workbook);
}

/** Returns the download name required by the Creator spec. */
export function fracWorkbookFilename(frac: Pick<Frac, "cadre" | "state">): string {
  return `${safeFilename(frac.cadre)} competencies - ${safeFilename(frac.state)}.xlsx`;
}

/** Returns the download name required by the Reviewer spec. */
export function reviewWorkbookFilename(title: string): string {
  return `FRAC review - ${safeFilename(title)}.xlsx`;
}

function safeFilename(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.-]+|[.-]+$/g, "") || "FRAC";
}
