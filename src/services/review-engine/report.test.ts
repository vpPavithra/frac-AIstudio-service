import { buildReport, normaliseAgentReview, summariseChecks } from "./report.js";
import type { Finding } from "../../models/report.model.js";

const f = (check: Finding["check"], sev: Finding["sev"], fixed?: boolean): Finding => ({
  check,
  sev,
  title: `${check} ${sev}`,
  detail: "",
  refs: [],
  fix: "",
  source: "computed",
  fixed,
});

describe("normaliseAgentReview", () => {
  it("coerces invalid sev/check/triage and tags source", () => {
    const r = normaliseAgentReview({
      verdict: "Needs work",
      triage: "burn it",
      findings: [{ check: "nonsense", sev: "X", title: "t", refs: ["C1", 2] }, null],
      strengths: ["clear roles", ""],
    });
    expect(r.triage).toBe("revise");
    expect(r.findings[0]).toMatchObject({ check: "structure", sev: "m", source: "agent", refs: ["C1", "2"] });
    expect(r.findings[1]).toMatchObject({ check: "structure", sev: "m", title: "" });
    expect(r.strengths).toEqual(["clear roles"]);
  });

  it("survives non-object input", () => {
    expect(normaliseAgentReview("oops")).toMatchObject({ findings: [], strengths: [], triage: "revise" });
  });

  it("keeps at most 10 agent findings", () => {
    const findings = Array.from({ length: 14 }, (_, i) => ({ check: "ladder", sev: "m", title: `t${i}` }));
    expect(normaliseAgentReview({ findings }).findings).toHaveLength(10);
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

describe("buildReport", () => {
  it("merges and sorts findings B → M → m and falls back to the agent's cadre", () => {
    const agent = normaliseAgentReview({ cadre: "GNM", verdict: "v", triage: "rebuild", summary: "s", findings: [{ check: "context", sev: "B" }] });
    const stats = { roles: 0, activities: 0, competencies: 0, indicators: 0, B: 0, F: 0, D: 0, other: 0 };
    const report = buildReport({ title: "GNM.xlsx" }, stats, [f("bloom", "m"), f("ladder", "M")], agent, new Date("2026-11-02T00:00:00Z"));
    expect(report.findings.map((x) => x.sev)).toEqual(["B", "M", "m"]);
    expect(report).toMatchObject({ cadre: "GNM", state: "", triage: "rebuild", at: "2026-11-02T00:00:00.000Z" });
  });
});
