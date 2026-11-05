import { buildReport, computeTriage, computeVerdict, sortFindings, summariseChecks } from "./report.ts";
import type { Finding } from "../../models/report.model.ts";

const f = (check: Finding["check"], sev: Finding["sev"], fixed?: boolean, over: Partial<Finding> = {}): Finding => ({
  check,
  sev,
  title: `${check} ${sev}`,
  detail: "",
  refs: [],
  fix: "",
  source: "computed",
  fixed,
  ...over,
});
const stats = { roles: 2, activities: 4, competencies: 3, indicators: 0, B: 1, F: 1, D: 1, other: 0 };

describe("sortFindings", () => {
  it("orders by severity, then check order, then rule-based before AI", () => {
    const sorted = sortFindings([f("coverage", "M"), f("context", "B", false, { source: "agent" }), f("bloom", "M"), f("context", "B")]);
    expect(sorted.map((x) => [x.check, x.sev, x.source])).toEqual([
      ["context", "B", "computed"],
      ["context", "B", "agent"],
      ["bloom", "M", "computed"],
      ["coverage", "M", "computed"],
    ]);
  });
});

describe("summariseChecks", () => {
  it("uses the worst open severity per check", () => {
    const checks = summariseChecks([f("bloom", "m"), f("bloom", "B"), f("ladder", "M"), f("context", "B", true), f("coverage", "m")]);
    expect(checks.map((c) => [c.key, c.status, c.n])).toEqual([
      ["bloom", "Fix before use", 2],
      ["structure", "Pass", 0],
      ["ladder", "Needs work", 1],
      ["context", "Pass", 0],
      ["coverage", "Mostly fine", 1],
    ]);
  });
});

describe("computeTriage (rules r3 §7)", () => {
  it("rebuilds when activities read as syllabus outcomes or ladders are mostly incomplete", () => {
    expect(computeTriage({ findings: [f("structure", "m", false, { title: "Activities read as syllabus outcomes" })], laddered: 4, incompleteLadders: 0 })).toBe("rebuild");
    expect(computeTriage({ findings: [], laddered: 4, incompleteLadders: 3 })).toBe("rebuild");
  });

  it("revises on any Blocker or 3 Majors, otherwise use", () => {
    expect(computeTriage({ findings: [f("context", "B")], laddered: 4, incompleteLadders: 0 })).toBe("revise");
    expect(computeTriage({ findings: [f("bloom", "M"), f("ladder", "M"), f("coverage", "M")], laddered: 4, incompleteLadders: 0 })).toBe("revise");
    expect(computeTriage({ findings: [f("bloom", "M"), f("coverage", "m")], laddered: 4, incompleteLadders: 0 })).toBe("use");
  });
});

describe("computeVerdict", () => {
  it("counts findings and names what to fix first", () => {
    const findings = sortFindings([
      f("context", "B", false, { title: "Beyond ANM scope: Prescribing" }),
      f("context", "B", false, { title: "Beyond ANM scope: Curative management" }),
      f("ladder", "M", false, { title: "Level ladders are shifted upward" }),
      f("coverage", "M", false, { title: "Core ANM areas with no dedicated competency" }),
      f("bloom", "m"),
    ]);
    expect(computeVerdict("revise", findings, "ANM")).toBe(
      "Revise before use — 2 blockers, 2 major and 1 minor finding. Fix first: 2 kinds of act beyond ANM scope; Level ladders are shifted upward; Core ANM areas with no dedicated competency.",
    );
  });
});

describe("buildReport", () => {
  it("computes verdict, triage, summary and strengths from the findings", () => {
    const report = buildReport({
      title: "ANM.xlsx",
      cadre: "ANM",
      state: "Bihar",
      stats,
      computed: [f("bloom", "m"), f("ladder", "M")],
      agent: [f("context", "B", false, { source: "agent", title: "Other acts beyond ANM scope" })],
      coveredAreas: ["Antenatal care"],
      laddered: 3,
      incompleteLadders: 0,
      engine: "r3",
      fingerprint: "abc",
      at: new Date("2026-11-02T00:00:00Z"),
    });
    expect(report.findings.map((x) => x.sev)).toEqual(["B", "M", "m"]);
    expect(report).toMatchObject({ cadre: "ANM", state: "Bihar", triage: "revise", engine: "r3", fingerprint: "abc", at: "2026-11-02T00:00:00.000Z" });
    expect(report.summary).toContain("2 findings come from rule-based checks and are the same on every run; 1 comes from AI judgement");
    expect(report.strengths).toEqual(["Core areas covered: Antenatal care", "FRAC structure: no issues found", "Coverage & sources: no issues found"]);
  });
});
