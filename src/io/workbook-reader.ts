import ExcelJS from "exceljs";
import type { SheetData } from "../engine/parse-workbook.js";

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
 * Reads an .xlsx buffer into SheetData. Only values are read, never styles, so workbooks with
 * broken stylesheets (the GNM dictionary) still load. Swap this adapter if one ever fails.
 */
export async function readWorkbook(buffer: ArrayBuffer | Buffer): Promise<SheetData[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
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
