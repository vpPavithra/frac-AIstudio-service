import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseWorkbook } from "../review-engine/parse-workbook.ts";
import { workbook } from "../../../test/support/test-data.ts";
import { cellText, readWorkbook } from "./workbook-reader.ts";

describe("cellText", () => {
  it("flattens every exceljs value shape", () => {
    expect(cellText(null)).toBe("");
    expect(cellText(3)).toBe("3");
    expect(cellText(" C1 ")).toBe("C1");
    expect(cellText(new Date("2025-06-09T00:00:00Z"))).toBe("2025-06-09");
    expect(cellText({ richText: [{ text: "Compe" }, { text: "tency" }] })).toBe("Competency");
    expect(cellText({ formula: "A1", result: "C4" } as ExcelJS.CellValue)).toBe("C4");
    expect(cellText({ text: "link", hyperlink: "http://x" })).toBe("link");
    expect(cellText({ error: "#REF!" } as ExcelJS.CellValue)).toBe("");
  });
});

describe("readWorkbook", () => {
  it("reads an xlsx into sheets that parseWorkbook understands", async () => {
    const wb = new ExcelJS.Workbook();
    for (const sheet of workbook()) wb.addWorksheet(sheet.name).addRows(sheet.rows);
    const buffer = await wb.xlsx.writeBuffer();

    const sheets = await readWorkbook(buffer);
    expect(sheets.map((s) => s.name)).toEqual(["FRAC", "Competencies (H)", "Competencies"]);
    const { model } = parseWorkbook(sheets, "t");
    expect(model.competencies.map((c) => c.code)).toEqual(["C1", "C2", "C3"]);
    expect(model.roles.flatMap((r) => r.activities)).toHaveLength(3);
  });

  // Regression: exceljs's full loader rejects a sheet named "History" ("The name "History" is
  // protected"), so a real upload (a SonarQube export) failed with FILE_UNREADABLE. The fixture is
  // synthetic, laid out like that file (workbook.xml before the sheets in the zip).
  it("reads a workbook that has a sheet named History", async () => {
    const buffer = readFileSync(path.resolve("test/fixtures/regression/history-sheet.xlsx"));
    await expect(new ExcelJS.Workbook().xlsx.load(buffer as unknown as ArrayBuffer)).rejects.toThrow(/History/);

    const sheets = await readWorkbook(buffer);
    expect(sheets.map((s) => s.name)).toEqual(["Competencies", "History"]);
    expect(sheets[1].rows[0]).toEqual(["Snapshot History"]);
    expect(parseWorkbook(sheets, "t").model.competencies.map((c) => c.code)).toEqual(["C1"]);
  });

  it("throws when neither reader can open the file", async () => {
    await expect(readWorkbook(Buffer.from("not a zip"))).rejects.toThrow();
  });
});
