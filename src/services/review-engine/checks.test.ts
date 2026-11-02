import { loadOutdatedPatterns } from "../../config/outdated.ts";
import { computeChecks, computeStats, indicators, stripLead, typeClass } from "./checks.ts";
import { comp, goodLevels, model } from "../../../test/support/test-data.ts";
import type { Finding } from "../../models/report.model.ts";
import type { ReviewModel } from "../../models/review.model.ts";

const OUTDATED = loadOutdatedPatterns();
const run = (m: ReviewModel) => computeChecks(m, OUTDATED).findings;
const byTitle = (findings: Finding[], title: string) => findings.find((f) => f.title.startsWith(title));

describe("computeChecks", () => {
  it("passes a clean FRAC", () => {
    expect(run(model())).toEqual([]);
  });

  describe("bloom", () => {
    it("flags banned label verbs as Major when one level hits 25%", () => {
      const bad = goodLevels("x");
      bad[0] = { label: "Understands anatomy", desc: "Identifies organs" };
      bad[1] = { label: "Knows the steps", desc: "Lists steps" };
      const f = byTitle(run(model({ competencies: [comp("C1", "Domain", bad), comp("C2", "Functional"), comp("C3", "Behavioural")] })), "Level labels");
      expect(f?.sev).toBe("M");
      expect(f?.detail).toContain("L1 1/3");
      expect(f?.detail).toContain("Levels 1 and 2 barely differ");
      expect(f?.refs).toEqual(["C1"]);
    });

    it("is Minor below 25%", () => {
      const comps = ["C1", "C2", "C3", "C4", "C5"].map((c, i) => comp(c, ["Domain", "Functional", "Behavioural"][i % 3]));
      comps[0].levels[0].label = "- Is aware of hygiene";
      const roles = [{ code: "R1", title: "t", activities: comps.map((c, i) => ({ code: `A${i}`, text: "Conduct", postings: { P1: "Yes" }, refs: [{ code: c.code, level: 3 }] })) }];
      expect(byTitle(run(model({ competencies: comps, roles })), "Level labels")?.sev).toBe("m");
    });

    it("flags indicator-only violations as Minor", () => {
      const levels = goodLevels("x");
      levels[2].desc = "Manages cases\n- Understands referral";
      const f = byTitle(run(model({ competencies: [comp("C1", "Domain", levels), comp("C2", "Functional"), comp("C3", "Behavioural")] })), "Some indicators");
      expect(f?.sev).toBe("m");
    });
  });

  describe("structure", () => {
    it("flags syllabus-style activities", () => {
      const m = model();
      m.roles[0].activities[0].text = "Describes the cold chain";
      m.roles[0].activities[1].text = "Explains ANC";
      const f = byTitle(run(m), "Activities read like syllabus");
      expect(f?.sev).toBe("M");
      expect(f?.detail).toContain("2/4");
    });

    it("flags untyped dictionaries", () => {
      const m = model({ competencies: [comp("C1", ""), comp("C2", "-"), comp("C3", "")] });
      expect(byTitle(run(m), "Competencies are not typed")?.sev).toBe("M");
    });

    it("flags a missing Behavioural or Functional type", () => {
      const m = model({ competencies: [comp("C1", "Domain"), comp("C2", "Domain"), comp("C3", "Domain")] });
      expect(byTitle(run(m), "No Behavioural or Functional")?.fix).toContain("13 B + 21 F");
    });

    it("flags roles with fewer than 2 activities", () => {
      const m = model();
      m.roles[1].activities.pop();
      m.roles[0].activities.push({ code: "A4", text: "Refer", postings: { P1: "Yes" }, refs: [{ code: "C1", level: 4 }] });
      expect(byTitle(run(m), "Roles with fewer")?.refs).toEqual(["R2"]);
    });
  });

  describe("ladder", () => {
    it("flags incomplete ladders, repeated L5 labels and repeated levels", () => {
      const shared = (code: string) => {
        const levels = goodLevels(code);
        levels[4].label = "Mentors others";
        return comp(code, "Domain", levels);
      };
      const short = comp("C4", "Functional", goodLevels("y").map((l, i) => (i === 4 ? { label: "", desc: "" } : l)));
      const dup = goodLevels("z");
      dup[1].label = dup[0].label;
      const comps = [shared("C1"), shared("C2"), shared("C3"), short, comp("C5", "Behavioural", dup)];
      const findings = run(model({ competencies: comps, hasFrac: false, roles: [] }));
      expect(byTitle(findings, "Incomplete")?.sev).toBe("M");
      expect(byTitle(findings, "Generic L5")?.refs).toEqual(["C1", "C2", "C3"]);
      expect(byTitle(findings, "Same label")?.refs).toEqual(["C5"]);
    });
  });

  describe("coverage", () => {
    it("flags unmapped activities, unused and undefined competencies", () => {
      const m = model();
      m.roles[0].activities[1].refs = [];
      m.roles[1].activities[0].refs = [{ code: "C99", level: 3 }];
      const findings = run(m);
      expect(byTitle(findings, "Activities not mapped")?.detail).toContain('A2 "Screen pregnant women"');
      expect(byTitle(findings, "Competencies never used")?.refs).toEqual(["C2", "C3"]);
      expect(byTitle(findings, "Mappings point")?.refs).toEqual(["C99"]);
    });

    it("counts role-row refs as used", () => {
      const m = model();
      m.roles[0].activities[1].refs = [{ code: "C1", level: 3 }];
      m.roles[0].refs = [{ code: "C2", level: null }];
      expect(byTitle(run(m), "Competencies never used")).toBeUndefined();
    });

    it("flags some (not all) activities with blank postings", () => {
      const m = model();
      m.roles[0].activities[0].postings = { P1: "" };
      expect(byTitle(run(m), "Activities with no posting")?.refs).toEqual(["A1"]);
      m.roles.forEach((r) => r.activities.forEach((a) => (a.postings = {})));
      expect(byTitle(run(m), "Activities with no posting")).toBeUndefined();
    });

    it("skips FRAC-sheet checks when there is no FRAC sheet", () => {
      expect(run(model({ hasFrac: false, roles: [] }))).toEqual([]);
    });
  });

  describe("context", () => {
    it("flags repealed laws as Blockers and old programme names", () => {
      const m = model();
      m.competencies[0].levels[2].desc = "Applies the Lunacy Act 1912\n- Follows NDPS act of 1965";
      m.roles[0].activities[0].text = "Give TT injection at the HWC";
      const findings = run(m);
      expect(byTitle(findings, "Outdated reference: Lunacy")?.sev).toBe("B");
      expect(byTitle(findings, "Outdated reference: NDPS")?.sev).toBe("B");
      expect(byTitle(findings, "Outdated reference: TT")?.refs).toEqual(["A1"]);
      expect(byTitle(findings, "Outdated reference: HWC")?.sev).toBe("m");
    });

    it("does not flag lowercase 'tt' or the MTP Act when 2021 is nearby", () => {
      const m = model();
      m.roles[0].activities[0].text = "Counsel under the MTP Act 1971 as amended in 2021; check the button";
      expect(run(m)).toEqual([]);
      m.roles[0].activities[0].text = "Counsel under the MTP Act 1971";
      expect(byTitle(run(m), "Outdated reference: MTP")).toBeDefined();
    });
  });
});

describe("helpers", () => {
  it("stripLead removes bullets and numbering", () => {
    expect(stripLead("- • 1. ) Identifies")).toBe("Identifies");
    expect(indicators("Identifies\n-  Records\n\n- ")).toEqual(["Identifies", "Records"]);
  });

  it("typeClass reads the first letter", () => {
    expect(["Behavioural", "functional", "Domain", "", "Other"].map(typeClass)).toEqual(["B", "F", "D", "other", "other"]);
  });

  it("computeStats counts types and indicators", () => {
    expect(computeStats(model())).toEqual({ roles: 2, activities: 4, competencies: 3, indicators: 30, B: 1, F: 1, D: 1, other: 0 });
  });
});
