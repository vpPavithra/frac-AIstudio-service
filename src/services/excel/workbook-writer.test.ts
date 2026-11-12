import ExcelJS from "exceljs";
import { parseWorkbook } from "../review-engine/parse-workbook.ts";
import type { Finding, Report } from "../../models/report.model.ts";
import type { Frac } from "../../models/frac.model.ts";
import { readWorkbook } from "./workbook-reader.ts";
import {
  buildFracWorkbook,
  buildReviewWorkbook,
  fracWorkbookFilename,
  reviewWorkbookFilename,
} from "./workbook-writer.ts";

function frac(): Frac {
  return {
    id: "frac-1",
    createdAt: "2026-10-28T00:00:00.000Z",
    updatedAt: "2026-10-28T00:00:00.000Z",
    ownerId: "user-1",
    step: 6,
    cadre: "ANM",
    cadreFull: "Auxiliary Nurse Midwife",
    state: "Bihar",
    size: "standard",
    prompt: "",
    codePrefix: "ANM",
    postings: [{ key: "P1", label: "ANM at Sub-Centre" }, { key: "P2", label: "ANM at PHC" }],
    research: {
      summary: "Provides frontline health services.",
      sourceNotes: "",
      sources: [{ title: "IPHS 2022", issuer: "MoHFW", year: "2022", use: "Facility duties", tier: "Facility standard" }],
      authorised: "Conduct outreach",
      notAuthorised: "Do not prescribe outside protocol",
      stateContext: "Bihar programme context",
      assumptions: "VERIFY: state posting titles",
    },
    roles: [
      {
        code: "R1",
        title: "Conduct VHSND sessions",
        source: "IPHS 2022",
        activities: [
          {
            code: "A1",
            text: "Conduct immunisation session",
            postings: { P1: "Yes", P2: "No" },
            source: "JD",
            tier: "JD",
            comp: "ANM1@L3, ANM2@L4",
          },
          {
            code: "A2",
            text: "Screen pregnant women",
            postings: { P1: "Yes", P2: "Yes" },
            source: "JD",
            tier: "JD",
            comp: "ANM1@L3",
          },
        ],
      },
    ],
    competencies: [
      {
        code: "ANM1",
        label: "Immunisation delivery",
        description: "Conducts safe immunisation sessions",
        type: "Domain",
        area: "PH",
        kcm: "Domain – department-defined",
        levels: [
          { label: "Identifies needs", desc: "Identifies eligible clients\n- Records due vaccines" },
          { label: "Prepares with support", desc: "Prepares session materials\n- Seeks support when needed" },
          { label: "Conducts independently", desc: "Conducts sessions\n- Records doses" },
          { label: "Manages complex sessions", desc: "Manages adverse events\n- Coordinates referrals" },
          { label: "Audits and mentors", desc: "Audits session records\n- Mentors peers" },
        ],
      },
      {
        code: "ANM2",
        label: "Clinical screening",
        description: "Screens clients using approved protocols",
        type: "Functional",
        area: "PH",
        kcm: "Communication",
        levels: null,
      },
    ],
    rolesDirty: false,
    review: null,
    log: [],
  };
}

function review(): Report {
  const finding: Finding = {
    check: "coverage",
    sev: "M",
    title: "Unmapped activities",
    detail: "A3 has no competency mapping.",
    refs: ["A3"],
    fix: "Map the activity.",
    source: "computed",
  };
  return {
    title: "ANM — Bihar",
    cadre: "ANM",
    state: "Bihar",
    at: "2026-10-28T00:00:00.000Z",
    stats: { roles: 1, activities: 2, competencies: 2, indicators: 10, B: 0, F: 1, D: 1, other: 0 },
    verdict: "Revise before use.",
    triage: "revise",
    summary: "Some mappings need attention.",
    checks: [],
    findings: [finding],
    strengths: [],
  };
}

describe("buildFracWorkbook", () => {
  it("writes specified sheets, styles and a workbook that round-trips through the reviewer parser", async () => {
    const buffer = await buildFracWorkbook({ ...frac(), review: review() }, "Approved method paragraph.");
    const sheets = await readWorkbook(buffer);
    const names = sheets.map((sheet) => sheet.name);

    expect(names).toEqual(["FRAC", "Competencies", "Method & Sources", "Expert check"]);
    expect(sheets[0].rows[0]).toEqual([
      "Role",
      "Activity",
      "P1: ANM at Sub-Centre",
      "P2: ANM at PHC",
      "Tentative Competency Label",
      "Source",
      "Source tier",
    ]);
    expect(sheets[0].rows[1]).toEqual(["R1", "Conduct VHSND sessions", "", "", "ANM1, ANM2", "IPHS 2022", ""]);
    expect(sheets[2].rows).toContainEqual(["Method", "Approved method paragraph."]);
    expect(sheets[2].rows).toContainEqual(["Title", "Issuer", "Year", "Use", "Tier", "URL"]);
    expect(sheets[3].rows[5]).toEqual(["Severity", "Check", "Finding", "Detail", "Refs", "Suggested fix", "Found by"]);

    const { model } = parseWorkbook(sheets, "ANM competencies - Bihar.xlsx");
    expect(model.hasFrac).toBe(true);
    expect(model.postingLabels).toEqual(["ANM at Sub-Centre", "ANM at PHC"]);
    expect(model.roles[0].activities[0].refs).toEqual([
      { code: "ANM1", level: 3 },
      { code: "ANM2", level: 4 },
    ]);
    expect(model.competencies[0]).toMatchObject({
      code: "ANM1",
      description: "Conducts safe immunisation sessions",
      levels: frac().competencies[0].levels,
      kcm: "Domain – department-defined",
    });

    const excel = new ExcelJS.Workbook();
    await excel.xlsx.load(buffer);
    const header = excel.getWorksheet("FRAC")?.getRow(1).getCell(1);
    expect(header?.font.bold).toBe(true);
    expect(header?.fill).toMatchObject({ fgColor: { argb: "FFB7DDE0" } });
    expect(header?.alignment).toMatchObject({ vertical: "top", wrapText: true });
    expect(excel.getWorksheet("FRAC")?.getRow(2).getCell(1).fill).toMatchObject({
      fgColor: { argb: "FFD9EDEF" },
    });
  });

  it("omits the expert-check sheet when the FRAC has no review", async () => {
    const sheets = await readWorkbook(await buildFracWorkbook(frac(), "Method."));
    expect(sheets.map((sheet) => sheet.name)).toEqual(["FRAC", "Competencies", "Method & Sources"]);
    expect(sheets[2].rows.find((r) => r[0] === "Built")?.[1]).toContain("not yet expert-checked");
  });

  it("leaves an out-of-date check out of a draft download, and marks a checked one", async () => {
    const draft = await readWorkbook(await buildFracWorkbook({ ...frac(), review: review(), reviewStale: true }, "Method."));
    expect(draft.map((sheet) => sheet.name)).toEqual(["FRAC", "Competencies", "Method & Sources"]);
    const checked = await readWorkbook(await buildFracWorkbook({ ...frac(), review: review() }, "Method."));
    expect(checked[2].rows.find((r) => r[0] === "Built")?.[1]).toContain("— expert-checked;");
  });
});

describe("buildReviewWorkbook", () => {
  it("styles the findings header row, below the Method row", async () => {
    const excel = new ExcelJS.Workbook();
    await excel.xlsx.load(await buildReviewWorkbook(review()));
    const header = excel.getWorksheet("Review")?.getRow(6).getCell(1);
    expect(header?.value).toBe("Severity");
    expect(header?.font.bold).toBe(true);
    expect(header?.fill).toMatchObject({ fgColor: { argb: "FFB7DDE0" } });
  });

  it("writes the review report to a single Review sheet", async () => {
    const sheets = await readWorkbook(await buildReviewWorkbook(review()));
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("Review");
    expect(sheets[0].rows[0]).toEqual(["Verdict", "Revise before use."]);
    expect(sheets[0].rows[1]).toEqual(["Triage", "Revise"]);
    expect(sheets[0].rows[3][0]).toBe("Method");
    expect(sheets[0].rows[3][1]).toMatch(/^Rule-based checks give the same result on every run\./);
    expect(sheets[0].rows[5]).toEqual(["Severity", "Check", "Finding", "Detail", "Refs", "Suggested fix", "Found by"]);
    expect(sheets[0].rows[6]).toEqual([
      "MAJOR",
      "coverage",
      "Unmapped activities",
      "A3 has no competency mapping.",
      "A3",
      "Map the activity.",
      "Rule-based check",
    ]);
  });
});

describe("workbook filenames", () => {
  it("sanitizes filesystem-unsafe characters", () => {
    expect(fracWorkbookFilename({ cadre: "ANM/Staff", state: "Bihar: East" })).toBe(
      "ANM-Staff competencies - Bihar- East.xlsx",
    );
    expect(reviewWorkbookFilename("ANM / Bihar")).toBe("FRAC review - ANM - Bihar.xlsx");
  });
});
