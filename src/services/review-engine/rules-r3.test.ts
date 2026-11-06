// Review engine r3 rules (docs/spec/FRAC_Reviewer_rules_r3.md §2–5) on small hand-made models.
import { loadReviewRules } from "../../config/review-rules.ts";
import { computeChecks, sentences } from "./checks.ts";
import { parseWorkbook } from "./parse-workbook.ts";
import { cadreFamily } from "./rules.ts";
import { comp, goodLevels, model } from "../../../test/support/test-data.ts";
import type { Finding } from "../../models/report.model.ts";
import type { ModelCompetency, ReviewModel } from "../../models/review.model.ts";

const RULES = loadReviewRules();
const anm = (m: ReviewModel) => computeChecks(m, RULES, { cadre: "ANM" });
const byTitle = (findings: Finding[], title: string) => findings.find((f) => f.title.startsWith(title));
const domain = (code: string, label: string, description = `Conducts ${code}`): ModelCompetency => ({ ...comp(code, "Domain"), label, description });

describe("cadreFamily (§3)", () => {
  it("maps cadres to families in order", () => {
    expect(["ASHA", "ANM", "MPW (F)", "LHV", "Community Health Officer", "GNM", "Staff Nurse", "Pharmacist"].map(cadreFamily)).toEqual([
      "asha", "anm", "anm", "anm", "cho", "nurse", "nurse", null,
    ]);
  });
});

describe("scope (§4.4)", () => {
  it("raises one finding per act with codes, levels and a quote", () => {
    const c = comp("C1", "Domain");
    c.levels[3] = { label: "Manages complications of labour", desc: "Manages obstetric complications\n- Prescribes antibiotics" };
    const { findings, scopeHits } = anm(model({ competencies: [c, comp("C2", "Functional"), comp("C3", "Behavioural")] }));
    const complications = byTitle(findings, "Beyond ANM scope: Managing complications");
    expect(complications).toMatchObject({ sev: "B", check: "context", refs: ["C1"] });
    expect(complications?.detail).toContain("C1 L4");
    expect(byTitle(findings, "Beyond ANM scope: Prescribing")?.detail).toContain('"Prescribes antibiotics"');
    expect(scopeHits.map((h) => [h.code, h.level, h.rule])).toEqual([["C1", 4, "complications"], ["C1", 4, "prescribing"]]);
  });

  it("does not read a previous caesarean in a risk-factor list as an operative procedure, but still flags performing one", () => {
    const c = comp("C1", "Domain");
    c.levels[0].desc = "Name the common high-risk conditions (severe anaemia, hypertension, previous caesarean, multiple pregnancy) from the RCH list.";
    expect(byTitle(anm(model({ competencies: [c] })).findings, "Beyond ANM scope: Operative")).toBeUndefined();
    c.levels[0].desc = "Assists the MO during a caesarean section.";
    expect(byTitle(anm(model({ competencies: [c] })).findings, "Beyond ANM scope: Operative")?.sev).toBe("B");
  });

  it("clears IV access for referral, but not IV drugs", () => {
    const ok = comp("C1", "Domain");
    ok.levels[2].desc = "Secures IV access before referral";
    expect(byTitle(anm(model({ competencies: [ok] })).findings, "Beyond ANM scope: IV")).toBeUndefined();
    ok.levels[2].desc = "Gives IV antibiotics";
    expect(byTitle(anm(model({ competencies: [ok] })).findings, "Beyond ANM scope: IV")?.sev).toBe("B");
  });

  it("does not run for a cadre with no scope list", () => {
    const c = comp("C1", "Domain");
    c.levels[3].desc = "Prescribes antibiotics";
    expect(computeChecks(model({ competencies: [c] }), RULES, { cadre: "GNM" }).scopeHits).toEqual([]);
  });

  it("splits inline ' -' indicators into sentences", () => {
    expect(sentences("Conducts the test -Interprets results. Records it")).toEqual(["Conducts the test", "Interprets results.", "Records it"]);
  });
});

describe("ladder shift (§4.3)", () => {
  it("collects every rule that hit into one Major, frontline rules only for frontline cadres", () => {
    const c = comp("C1", "Domain");
    c.levels[0].desc = "Works independently";
    c.levels[2].desc = "Supervises ASHAs";
    c.levels[4].desc = "Shapes state-level policy";
    const m = model({ competencies: [c, comp("C2", "Functional"), comp("C3", "Behavioural")] });
    const f = byTitle(anm(m).findings, "Level ladders are shifted upward");
    expect(f?.sev).toBe("M");
    expect(f?.detail.split("\n").slice(0, 3)).toEqual([
      "L1–L2 already say the worker acts independently: 1 of 3 competencies (C1).",
      "L3 includes supervising, mentoring or training others: 1 of 3 competencies (C1).",
      "L4–L5 describe policy, research or district/state roles: 1 of 3 competencies (C1).",
    ]);
    const other = byTitle(computeChecks(m, RULES, { cadre: "Pharmacist" }).findings, "Level ladders are shifted upward");
    expect(other?.detail.split("\n")).toHaveLength(2);
  });
});

describe("breadth (§4.2.1)", () => {
  it("flags catch-all, scheme-list and above-the-post labels, and topic definitions", () => {
    const m = model({
      competencies: [
        domain("D1", "Clinical Skills"),
        domain("D2", "National Health Programs"),
        domain("D3", "District Health Organization & Functioning"),
        domain("D4", "Antenatal care", "Knowledge of antenatal care"),
        comp("F1", "Functional"),
        comp("B1", "Behavioural"),
      ],
    });
    const f = byTitle(anm(m).findings, "Competencies are too broadly defined");
    expect(f?.sev).toBe("M");
    expect(f?.detail).toMatch(/^3 of 4 Domain competencies are too broad/);
    expect(f?.detail).toContain("Catch-all labels that name a whole field: D1.");
    expect(f?.detail).toContain("Lists of programmes or schemes: D2.");
    expect(f?.detail).toContain("above the post: D3.");
    expect(f?.detail).toContain("1 definitions are topics");
  });

  it("does not flag several narrow competencies in one area", () => {
    const m = model({
      competencies: [domain("D1", "Essential newborn care"), domain("D2", "Neonatal resuscitation"), domain("D3", "Low birth weight newborn care"), comp("F1", "Functional"), comp("B1", "Behavioural")],
    });
    expect(byTitle(anm(m).findings, "Competencies are too broadly defined")).toBeUndefined();
  });

  it("is minor when only definitions are topics", () => {
    const m = model({ competencies: [domain("D1", "Antenatal care", "Understanding of ANC"), comp("F1", "Functional"), comp("B1", "Behavioural")] });
    expect(byTitle(anm(m).findings, "Competencies are too broadly defined")?.sev).toBe("m");
  });
});

describe("coverage (§4.6, §5)", () => {
  it("lists core areas with no competency and the activities that need them", () => {
    const m = model({ competencies: [domain("D1", "Antenatal care"), comp("F1", "Functional"), comp("B1", "Behavioural")] });
    m.roles[0].activities[0].text = "Counsel couples on family planning methods";
    const f = byTitle(anm(m).findings, "Core ANM areas with no dedicated competency");
    expect(f?.sev).toBe("M");
    expect(f?.detail).toContain("Family planning (activities A1 need it)");
    expect(anm(m).coveredAreas).toContain("Antenatal care");
  });

  it("raises one minor instead of the mapping checks when there is no mapping column", () => {
    const m = model({ hasMapping: false });
    m.roles[0].activities.forEach((a) => (a.refs = []));
    const titles = computeChecks(m, RULES).findings.map((f) => f.title);
    expect(titles).toContain("Activities are not mapped to competencies yet");
    expect(titles).not.toContain("Activities not mapped to a competency");
    expect(titles).not.toContain("Competencies never used");
  });
});

describe("outdated terms (§4.5)", () => {
  it("raises partograph only when the file never names the Labour Care Guide", () => {
    const c = comp("C1", "Domain");
    c.levels[2].desc = "Plots the partograph";
    expect(byTitle(anm(model({ competencies: [c] })).findings, "Outdated reference: partograph")?.sev).toBe("m");
    c.levels[3].desc = "Uses the WHO Labour Care Guide";
    expect(byTitle(anm(model({ competencies: [c] })).findings, "Outdated reference: partograph")).toBeUndefined();
  });

  it("raises device law for frontline cadres only", () => {
    const c = comp("C1", "Domain");
    c.levels[2].desc = "Follows ISO 13485";
    expect(byTitle(anm(model({ competencies: [c] })).findings, "Outdated reference: ISO")).toBeDefined();
    expect(byTitle(computeChecks(model({ competencies: [c] }), RULES, { cadre: "Pharmacist" }).findings, "Outdated reference: ISO")).toBeUndefined();
  });
});

describe("parser (§2)", () => {
  const ladder = ["Code", "Competency Label", "Competency Type", ...[1, 2, 3, 4, 5].flatMap((n) => [`Level ${n} Label`, `Level ${n} Description`])];
  const levels = goodLevels("x").flatMap((l) => [l.label, l.desc]);

  it("reads every competency sheet, KCM-format rows, Position, and the single-column Roles/Activities layout", () => {
    const { model: m } = parseWorkbook(
      [
        { name: "Domain", rows: [["Position: ANM"], ladder, ["D1", "Antenatal care", "Domain", ...levels]] },
        { name: "KCM Functional", rows: [["Code", "Competency Label", "Applicable Level", "Theme 1 Description / Indicators"], ["F1", "Data management", "L2", "Maintains records"]] },
        { name: "KCM Behavioural", rows: [["Code", "Competency Label", "Applicable Level", "Theme 1 Description / Indicators"], ["B1", "Empathy", "L1", "Listens"]] },
        { name: "Roles", rows: [["Roles/Activities", "Description"], ["R1", "Provide ANC"], ["A1", "Conduct ANC check-ups"]] },
      ],
      "Meghalaya ANM.xlsx",
    );
    expect(m.position).toBe("ANM");
    expect(m.competencies.map((c) => [c.code, c.type, c.format ?? "ladder"])).toEqual([["D1", "Domain", "ladder"], ["F1", "Functional", "kcm"], ["B1", "Behavioural", "kcm"]]);
    expect(m.competencies[1]).toMatchObject({ themes: ["Maintains records"], applicableLevel: "L2", levels: [] });
    expect(m).toMatchObject({ hasFrac: true, hasMapping: false, postings: [] });
    expect(m.roles).toEqual([{ code: "R1", title: "Provide ANC", refs: [], activities: [{ code: "A1", text: "Conduct ANC check-ups", postings: {}, refs: [] }] }]);

    const { findings, stats } = computeChecks(m, RULES);
    expect(stats).toMatchObject({ D: 1, F: 1, B: 1, kcm: 2 });
    expect(byTitle(findings, "Functional and Behavioural competencies have no job ladder")?.refs).toEqual(["F1", "B1"]);
    expect(byTitle(findings, "Incomplete level ladders")).toBeUndefined();
  });
});
