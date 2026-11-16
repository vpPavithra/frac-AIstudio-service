// Reads an uploaded .xlsx file into plain rows of text (SheetData) for the review engine.
// Called by the Reviewer upload (review.service.ts) before parsing. Values only: styles, formulas and
// hyperlinks are dropped. Pure: no HTTP, no SQL.
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { Readable } from "node:stream";
import type { SheetData } from "../review-engine/parse-workbook.ts";

/** Flattens any exceljs cell value (rich text, formula, hyperlink, date) to plain text. */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "object") return String(value).trim();
  if ("richText" in value) return value.richText.map((t) => t.text).join("").trim();
  if ("text" in value) return cellText(value.text as ExcelJS.CellValue);
  if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
  if ("error" in value) return "";
  return "";
}

/**
 * Reads an .xlsx buffer into SheetData, values only.
 *
 * Tries exceljs's full loader first. It is stricter than Excel: it parses every stylesheet (the GNM
 * dictionary's breaks other tools, spec 6.1) and rejects any workbook with a sheet named "History",
 * a name Excel only reserves when *writing* (a real SonarQube export failed this way). When it
 * refuses a file, the streaming reader is tried, which skips styles and applies neither rule. The
 * streaming reader is not used first because it cannot read files whose zip lists the worksheets
 * before workbook.xml, which is how exceljs itself writes them (our own exports included).
 * If both fail, the full loader's error is thrown.
 */
export async function readWorkbook(buffer: ArrayBuffer | Buffer): Promise<SheetData[]> {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  try {
    return await readWithFullLoader(bytes);
  } catch (strictError) {
    // A protected sheet name ("History"): rename it in workbook.xml and load again. Deterministic, unlike the
    // streaming reader, which could drop a sheet under load (the flaky History test, Nov 2026).
    if (strictError instanceof Error && PROTECTED_NAME.test(strictError.message)) {
      try {
        return await readRenamingProtected(bytes);
      } catch {
        // fall through to the streaming reader
      }
    }
    try {
      return await readWithStreamingReader(bytes);
    } catch {
      throw strictError;
    }
  }
}

/** exceljs's full loader refuses these sheet names, which Excel reserves only when writing a file. */
const PROTECTED_NAMES = ["History"];
const PROTECTED_NAME = /The name ".*" is protected/;
/** Suffix for a renamed protected sheet while it loads; put back on the result, so callers see the real name. */
const RENAMED_SUFFIX = "__frac_studio";

/**
 * Loads a workbook that has a protected sheet name: renames the sheet in xl/workbook.xml, loads it with the full
 * loader, and gives the sheet its own name back. The upload passed assertZipSafe before it got here.
 */
async function readRenamingProtected(bytes: Buffer): Promise<SheetData[]> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file("xl/workbook.xml");
  if (!entry) throw new Error("No xl/workbook.xml");
  const names = PROTECTED_NAMES.join("|");
  const xml = (await entry.async("string")).replace(new RegExp(`(<sheet\\b[^>]*\\bname=")(${names})(")`, "gi"), `$1$2${RENAMED_SUFFIX}$3`);
  zip.file("xl/workbook.xml", xml);
  const sheets = await readWithFullLoader(await zip.generateAsync({ type: "nodebuffer" }));
  return sheets.map((s) => (s.name.endsWith(RENAMED_SUFFIX) ? { ...s, name: s.name.slice(0, -RENAMED_SUFFIX.length) } : s));
}

/** Loads the whole workbook with exceljs. Strict about styles and sheet names, but accepts any zip entry order. */
async function readWithFullLoader(bytes: Buffer): Promise<SheetData[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb.worksheets.map((ws) => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (c, colNumber) => {
        values[colNumber - 1] = cellText(c.value);
      });
      rows[rowNumber - 1] = Array.from(values, (v) => v ?? "");
    });
    return { name: ws.name, rows: Array.from(rows, (r) => r ?? []) };
  });
}

/** Fallback reader: streams the zip, ignoring styles and hyperlinks, for files the full loader refuses. */
async function readWithStreamingReader(bytes: Buffer): Promise<SheetData[]> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([bytes]), {
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    worksheets: "emit",
    entries: "emit",
  });

  const sheets: SheetData[] = [];
  for await (const worksheet of reader) {
    const rows: string[][] = [];
    for await (const row of worksheet) {
      // row.values is 1-indexed and sparse: index 0 is unused, missing cells are holes
      const values = row.values as ExcelJS.CellValue[];
      rows[row.number - 1] = Array.from({ length: Math.max(values.length - 1, 0) }, (_, i) => cellText(values[i + 1]));
    }
    // exceljs types the emitted sheet loosely; the name is always present on a worksheet entry
    sheets.push({ name: (worksheet as unknown as { name: string }).name, rows: Array.from(rows, (r) => r ?? []) });
  }
  return sheets;
}
