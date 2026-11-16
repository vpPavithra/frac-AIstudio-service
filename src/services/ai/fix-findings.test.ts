import type { Frac } from "../../models/frac.model.ts";
import type { Finding } from "../../models/report.model.ts";
import { applyFixEdits, fixAllNotReady, groupFindings, type FixEdits } from "./fix-findings.ts";

const frac = (over: Partial<Frac> = {}): Frac => ({
  id: "f1", createdAt: "", updatedAt: "", ownerId: "o", step: 6, cadre: "ANM", cadreFull: "ANM", state: "Uttar Pradesh",
  size: "standard", prompt: "", codePrefix: "ANM", postings: [], research: null,
  roles: [{ code: "R1", title: "Care", source: "", activities: [
    { code: "A1", text: "Knows immunisation", postings: {}, source: "", tier: "", comp: "ANM1@L3" },
    { code: "A2", text: "Counsel mothers", postings: {}, source: "", tier: "", comp: "ANM1@L3" },
  ] }],
  competencies: [
    { code: "ANM1", label: "Immunisation", description: "", type: "Domain", area: "", kcm: "", levels: null },
    { code: "ANM3", label: "Communication", description: "", type: "Domain", area: "", kcm: "", levels: null },
  ],
  rolesDirty: false, review: null, log: [], ...over,
});

const finding = (over: Partial<Finding>): Finding => ({ check: "structure", sev: "m", title: "t", detail: "", refs: [], fix: "", source: "computed", ...over });
const edits = (over: Partial<FixEdits>): FixEdits => ({ activities: [], competencies: [], newCompetencies: [], skipped: [], ...over });

describe("groupFindings", () => {
  const all = [
    finding({ check: "context", title: "Outdated reference: TT / tetanus toxoid", refs: ["A1", "ANM1"] }),
    finding({ check: "bloom", title: "Level labels use non-measurable verbs", refs: ["ANM1"] }),
    finding({ check: "structure", title: "Activities read as syllabus outcomes", refs: ["A1"] }),
    finding({ check: "context", title: "Does not reflect Uttar Pradesh", refs: ["ANM1"] }),
    finding({ check: "coverage", title: "Core areas missing", refs: ["A2"] }),
    finding({ check: "bloom", title: "Fixed already", refs: ["ANM1"], fixed: true }),
  ];

  it("sends ladder findings to the ladders step, the rest to the agent, and outdated names to both", () => {
    const groups = groupFindings(frac(), all);
    expect(groups.ladders.map((f) => f.title)).toEqual(["Outdated reference: TT / tetanus toxoid", "Level labels use non-measurable verbs"]);
    expect(groups.content.map((f) => f.title)).toEqual([
      "Outdated reference: TT / tetanus toxoid", "Activities read as syllabus outcomes", "Does not reflect Uttar Pradesh", "Core areas missing",
    ]);
  });

  it("keeps only the findings a button names", () => {
    const groups = groupFindings(frac(), all, ["Activities read as syllabus outcomes"]);
    expect(groups).toEqual({ ladders: [], content: [all[2]] });
  });

  it("sends a ladder finding that names no competency to the agent", () => {
    expect(groupFindings(frac(), [finding({ check: "ladder", refs: ["A1"] })]).content).toHaveLength(1);
  });
});

describe("fixAllNotReady", () => {
  it("needs an expert check with an open finding, among the named ones when given", () => {
    expect(fixAllNotReady(frac())).toMatch(/Run the expert check/);
    const review = { findings: [finding({ fixed: true })] } as Frac["review"];
    expect(fixAllNotReady(frac({ review }))).toMatch(/no open findings/);
    const open = frac({ review: { findings: [finding({ title: "Open one" })] } as Frac["review"] });
    expect(fixAllNotReady(open)).toBeNull();
    expect(fixAllNotReady(open, ["Open one"])).toBeNull();
    expect(fixAllNotReady(open, ["Gone"])).toMatch(/no longer open/);
  });
});

describe("applyFixEdits", () => {
  it("rewrites existing activities and competencies only", () => {
    const out = applyFixEdits(frac(), edits({
      activities: [{ code: "a1", text: "Conduct immunisation sessions" }, { code: "A99", text: "Ghost" }, { code: "A2", text: "  " }],
      competencies: [{ code: "ANM3", label: "", description: "", type: "Behavioural", area: "", }, { code: "X1", label: "Ghost", description: "", type: "", area: "" }],
    }));
    expect(out.roles[0].activities.map((a) => a.text)).toEqual(["Conduct immunisation sessions", "Counsel mothers"]);
    expect(out.competencies.find((c) => c.code === "ANM3")).toMatchObject({ type: "Behavioural", label: "Communication" });
    expect(out.competencies).toHaveLength(2);
    expect(out.changes).toBe(2);
  });

  it("adds competencies with the next codes and links their activities, up to the cap", () => {
    const out = applyFixEdits(frac(), edits({
      newCompetencies: [
        { label: "Counselling", description: "d", type: "Functional", area: "", activities: [{ code: "A2", level: 4 }] },
        { label: "Nothing real", description: "", type: "Domain", area: "", activities: [{ code: "A99", level: 3 }] },
        { label: "Over the cap", description: "", type: "Domain", area: "", activities: [{ code: "A1", level: 3 }] },
      ],
    }), 1);
    expect(out.newCodes).toEqual(["ANM4"]);
    expect(out.competencies.at(-1)).toMatchObject({ code: "ANM4", label: "Counselling", levels: null });
    expect(out.roles[0].activities[1].comp).toBe("ANM4@L4");
    expect(out.roles[0].activities[0].comp).toBe("ANM1@L3");
  });
});
