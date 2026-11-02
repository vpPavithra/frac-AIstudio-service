import { competencyRefs, fracToModel, modelToFrac, serializeModel } from "./convert.js";
import { parseWorkbook } from "./parse-workbook.js";
import { workbook } from "../../../test/support/test-data.js";
import type { Frac } from "../../models/frac.model.js";

function frac(): Frac {
  return {
    id: "f1",
    createdAt: "",
    updatedAt: "",
    ownerId: "u1",
    step: 6,
    cadre: "ANM",
    cadreFull: "Auxiliary Nurse Midwife",
    state: "Bihar",
    size: "standard",
    prompt: "",
    codePrefix: "ANM",
    postings: [{ key: "P1", label: "ANM at Sub-Centre" }],
    research: null,
    roles: [
      {
        code: "R1",
        title: "Conduct VHSND",
        source: "JD",
        activities: [{ code: "A1", text: "Conduct session", postings: { P1: "Yes" }, source: "JD", tier: "JD", comp: "ANM1@L3, 2" }],
      },
    ],
    competencies: [
      { code: "ANM1", label: "Immunisation", description: "Delivers", type: "Domain", area: "PH", kcm: "Domain – department-defined", levels: null },
      { code: "ANM2", label: "Records", description: "Keeps", type: "Functional", area: "Data", kcm: "", levels: null },
    ],
    rolesDirty: false,
    review: null,
    log: [],
  };
}

describe("fracToModel", () => {
  it("parses every ref in the mapping cell and fills empty ladders", () => {
    const m = fracToModel(frac());
    expect(m.title).toBe("ANM — Bihar");
    expect(m.roles[0].activities[0].refs).toEqual([
      { code: "ANM1", level: 3 },
      { code: "ANM2", level: null },
    ]);
    expect(m.competencies[0].levels).toHaveLength(5);
  });
});

describe("modelToFrac", () => {
  it("imports a reviewed workbook at step 6 with posting keys remapped", () => {
    const { model } = parseWorkbook(workbook(), "ANM.xlsx");
    const f = modelToFrac({ model, report: null, sourceName: "ANM.xlsx", ownerId: "u1", id: "x", cadre: "ANM", now: new Date(0) });
    expect(f).toMatchObject({ step: 6, imported: "ANM.xlsx", codePrefix: "C", cadre: "ANM" });
    expect(f.postings).toEqual([
      { key: "P1", label: "ANM at Sub-Centre" },
      { key: "P2", label: "ANM at PHC" },
    ]);
    expect(f.roles[0].activities[0]).toMatchObject({ postings: { P1: "Yes", P2: "No" }, comp: "C1@L3" });
    expect(f.competencies[0].levels).toHaveLength(5);
  });

  it("round-trips through fracToModel", () => {
    const { model } = parseWorkbook(workbook(), "ANM.xlsx");
    const back = fracToModel(modelToFrac({ model, report: null, sourceName: "s", ownerId: "u", id: "x" }));
    expect(back.roles.flatMap((r) => r.activities.map((a) => a.refs))).toEqual(model.roles.flatMap((r) => r.activities.map((a) => a.refs)));
  });
});

describe("serializeModel", () => {
  it("writes the compact prompt form and truncates", () => {
    const m = fracToModel(frac());
    m.competencies[0].levels[0] = { label: "Identifies", desc: "Spots\n- Records" };
    const text = serializeModel(m);
    expect(text).toContain("A1 Conduct session → ANM1@L3, ANM2");
    expect(text).toContain("ANM1 Immunisation [Domain / PH] — Delivers");
    expect(text).toContain("L1 Identifies :: Spots - Records");
    expect(serializeModel(m, 20)).toMatch(/…\(truncated\)$/);
  });
});

describe("competencyRefs", () => {
  it("keeps only known competency codes", () => {
    const m = fracToModel(frac());
    const finding = { check: "ladder" as const, sev: "M" as const, title: "", detail: "", refs: ["ANM1", "A1", "R1"], fix: "", source: "agent" as const };
    expect(competencyRefs(finding, m)).toEqual(["ANM1"]);
  });
});
