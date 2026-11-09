// Writes the synthetic sample workbooks to test/fixtures/sample/ for manual uploads (Reviewer UI, Postman).
// Builds them from test/support/sample-workbooks.ts (SAMPLES), one .xlsx per entry, columns 28 wide.
// Usage: npm run fixtures:sample. Run by hand only; not part of the build or tests.
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { SAMPLES } from "../../test/support/sample-workbooks.js";

const outDir = path.resolve(process.cwd(), "test/fixtures/sample");
mkdirSync(outDir, { recursive: true });

for (const [file, build] of Object.entries(SAMPLES)) {
  const wb = new ExcelJS.Workbook();
  for (const sheet of build()) {
    const ws = wb.addWorksheet(sheet.name);
    ws.addRows(sheet.rows);
    ws.columns.forEach((c) => (c.width = 28));
  }
  await wb.xlsx.writeFile(path.join(outDir, file));
  console.log(`wrote ${path.join("test/fixtures/sample", file)}`);
}
