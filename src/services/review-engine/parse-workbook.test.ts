import { NO_COMPETENCY_SHEET, NO_FRAC_SHEET_WARNING, parseWorkbook, WorkbookParseError } from "./parse-workbook.ts";
import { COMP_HEADERS, workbook } from "../../../test/support/test-data.ts";

describe("parseWorkbook", () => {
  it("finds both sheets, skips Hindi copies and drops blank codes", () => {
    const { model, warnings } = parseWorkbook(workbook(), "ANM.xlsx");
    expect(warnings).toEqual([]);
    expect(model.hasFrac).toBe(true);
    expect(model.competencies.map((c) => c.code)).toEqual(["C1", "C2", "C3"]);
    expect(model.competencies[0].description).toBe("Conducts C1");
    expect(model.competencies[0].levels[4].label).toBe("Audits and mentors C1");
  });

  it("does not take a level description column as the competency description", () => {
    const headers = ["Code", "Competency Level 1 Description", "Competency Description", "Level 1 Label"];
    const { model } = parseWorkbook([{ name: "C", rows: [headers, ["C1", "level text", "real desc", "Identifies"]] }], "t");
    expect(model.competencies[0].description).toBe("real desc");
    expect(model.competencies[0].levels[0]).toEqual({ label: "Identifies", desc: "level text" });
  });

  it("reads roles, activities, postings and the misspelt mapping column", () => {
    const { model } = parseWorkbook(workbook(), "ANM.xlsx");
    expect(model.postings).toEqual(["P1: ANM at Sub-Centre", "P2: ANM at PHC"]);
    expect(model.postingLabels).toEqual(["ANM at Sub-Centre", "ANM at PHC"]);
    expect(model.roles.map((r) => r.code)).toEqual(["R1", "R2"]);
    expect(model.roles[0].refs?.map((r) => r.code)).toEqual(["C1", "C2"]);
    const [a1, a2] = model.roles[0].activities;
    expect(a1.postings["P2: ANM at PHC"]).toBe("No");
    expect(a1.refs).toEqual([{ code: "C1", level: 3 }]);
    expect(a2.refs).toEqual([{ code: "C2", level: null }]);
    expect(model.roles[1].activities[0].refs).toEqual([{ code: "C3", level: 4 }]);
  });

  it("treats a first non-A row as a role when no role is open", () => {
    const sheets = workbook();
    sheets[0].rows[2][0] = "";
    const { model } = parseWorkbook(sheets, "t");
    expect(model.roles[0].code).toBe("R1");
    expect(model.roles[0].title).toBe("Conduct VHSND sessions");
  });

  it("continues without a FRAC sheet and warns", () => {
    const { model, warnings } = parseWorkbook([workbook()[2]], "t");
    expect(model.hasFrac).toBe(false);
    expect(model.roles).toEqual([]);
    expect(warnings).toEqual([NO_FRAC_SHEET_WARNING]);
  });

  it("errors when there is no competency sheet", () => {
    expect(() => parseWorkbook([workbook()[0]], "t")).toThrow(WorkbookParseError);
    expect(() => parseWorkbook([{ name: "x", rows: [["Code", "Label"]] }], "t")).toThrow(NO_COMPETENCY_SHEET);
  });

  it("finds a header row below a title block", () => {
    const rows = [["Title"], [], ["Built 2024"], COMP_HEADERS, ["C1", "x"]];
    expect(parseWorkbook([{ name: "C", rows }], "t").model.competencies).toHaveLength(1);
  });
});
