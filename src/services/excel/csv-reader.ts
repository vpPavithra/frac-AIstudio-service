// CSV upload reader for the Creator's standard sheets (documents/import-sheets.ts): turns a CSV file into
// the same SheetData the workbook reader gives, so one importer handles both. RFC 4180 quoting
// ("a, b" and doubled "" quotes), CRLF or LF line ends, and a UTF-8 byte-order mark. No dependency.
import type { SheetData } from "../review-engine/parse-workbook.ts";

/** One sheet named after the file. Every cell is trimmed; fully blank rows are dropped. */
export function readCsv(buffer: Buffer, name: string): SheetData[] {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const clean = rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
  return [{ name, rows: clean }];
}
