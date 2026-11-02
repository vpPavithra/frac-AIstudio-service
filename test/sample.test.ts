// Runs the synthetic sample workbooks through the real xlsx path (write → readWorkbook → parse → checks)
// and asserts the planted counts exactly. The real dictionaries are covered by acceptance.test.ts.
import ExcelJS from "exceljs";
import { loadOutdatedPatterns } from "../src/config/outdated.js";
import { computeChecks } from "../src/engine/checks.js";
import { parseWorkbook } from "../src/engine/parse-workbook.js";
import type { SheetData } from "../src/engine/parse-workbook.js";
import type { Finding } from "../src/engine/types.js";
import { readWorkbook } from "../src/io/workbook-reader.js";
import { anmSample, GNM_COUNTS, gnmSample, staffNurseSample } from "./support/sample-workbooks.js";

async function review(sheets: SheetData[]) {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) wb.addWorksheet(s.name).addRows(s.rows);
  const parsed = parseWorkbook(await readWorkbook(await wb.xlsx.writeBuffer()), "sample.xlsx");
  return { ...parsed, ...computeChecks(parsed.model, loadOutdatedPatterns()) };
}

const find = (findings: Finding[], title: string) => findings.find((f) => f.title.startsWith(title));

describe("sample GNM dictionary", () => {
  it("reproduces the spec 6.6 numbers", async () => {
    const { model, findings, stats } = await review(gnmSample());
    expect(stats).toMatchObject({ competencies: GNM_COUNTS.competencies, activities: GNM_COUNTS.activities, roles: GNM_COUNTS.roles });
    // Hindi sheet skipped; description taken from the real column, not a level column
    expect(model.competencies.some((c) => c.code === "X1")).toBe(false);
    expect(model.competencies[0].description).toBe("Delivers newborn resuscitation (1) safely");

    const blockers = findings.filter((f) => f.sev === "B").map((f) => f.title);
    expect(blockers).toEqual([
      "Outdated reference: Lunacy Act / lunatic",
      "Outdated reference: Mental Health Act 1987",
      "Outdated reference: NDPS … 1965",
    ]);

    const unmapped = find(findings, "Activities not mapped");
    expect(unmapped?.detail).toMatch(new RegExp(`^${GNM_COUNTS.unmapped} of ${GNM_COUNTS.activities}`));
    expect(unmapped?.refs).toEqual(expect.arrayContaining(["A31", "A41"]));

    expect(find(findings, "Incomplete level ladders")).toMatchObject({ sev: "M" });
    expect(find(findings, "Incomplete level ladders")?.detail).toMatch(/^12 of 74/);
    expect(find(findings, "Level labels")).toMatchObject({ sev: "M" });
    expect(find(findings, "Level labels")?.detail).toContain(`L1 ${GNM_COUNTS.l1Banned}/${GNM_COUNTS.competencies}`);
    expect(find(findings, "Activities read like syllabus")?.detail).toMatch(/^92\/136/);
  });

  it("parses every mapping-cell style", async () => {
    const { model } = await review(gnmSample());
    const acts = model.roles.flatMap((r) => r.activities);
    expect(acts.find((a) => a.code === "A1")?.refs).toEqual([{ code: "ME1", level: 3 }]);
    expect(acts.find((a) => a.code === "A2")?.refs).toEqual([{ code: "ME2", level: 4 }]);
    expect(acts.find((a) => a.code === "A3")?.refs).toEqual([{ code: "ME3", level: null }]);
    expect(acts.find((a) => a.code === "A4")?.refs).toEqual([{ code: "ME4", level: 5 }]);
  });
});

describe("sample ANM dictionary", () => {
  it("reads the 'Comptency' column, role-row ranges, bare numbers and multi-ref cells", async () => {
    const { model, findings } = await review(anmSample());
    expect(model.postings).toEqual(["Sub-Centre", "PHC"]);
    expect(model.roles[0].refs?.map((r) => r.code)).toEqual(["C1", "C2", "C3", "C4"]);
    expect(model.roles[0].activities.map((a) => a.refs.map((r) => r.code))).toEqual([["C1"], ["C2"], ["C3", "C4"], ["C4"]]);
    expect(findings).toEqual([]);
  });
});

describe("sample Staff Nurse dictionary", () => {
  it("gives at most one minor computed finding", async () => {
    const { model, findings } = await review(staffNurseSample());
    expect(model.postingLabels).toEqual(["Staff Nurse at DH ward", "Staff Nurse at CHC"]);
    expect(findings.filter((f) => f.sev !== "m")).toEqual([]);
    expect(findings.length).toBeLessThanOrEqual(1);
  });
});
