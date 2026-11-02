import ExcelJS from "exceljs";
import { parseWorkbook } from "../review-engine/parse-workbook.js";
import { workbook } from "../../../test/support/test-data.js";
import { cellText, readWorkbook } from "./workbook-reader.js";

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
});
