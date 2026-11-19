import type { FracDocument } from "../../models/document.model.ts";
import type { Frac, FracCompetency, FracRole } from "../../models/frac.model.ts";
import type { CompletionRequest, TextProvider } from "../../providers/text/types.ts";
import { stepAfterFeedback } from "../frac.service.ts";
import { applyFeedbackPlan, feedbackSources, runFeedbackAgent, type FeedbackOutcome } from "./feedback-agent.ts";
import { feedbackAgentOutput } from "./schemas.ts";
import type { StepContext } from "./step-context.ts";

const comp = (code: string, label: string): FracCompetency => ({
  code, label, description: `Does ${label.toLowerCase()}`, type: "Domain", area: "Care", kcm: "Domain – department-defined",
  levels: [1, 2, 3, 4, 5].map((n) => ({ label: `Performs ${label} L${n}`, desc: `Indicator ${n}` })),
});
/** Activities are numbered across the whole sheet, as in a real dictionary: R2's first activity follows R1's last. */
const role = (code: string, title: string, acts: string[], first = 1): FracRole => ({
  code, title, source: "Dictionary",
  activities: acts.map((text, i) => ({ code: `A${first + i}`, text, postings: { P1: "Yes" }, source: "JD", tier: "JD", comp: "OLD1@L3" })),
});

const twelve = Array.from({ length: 12 }, (_, i) => comp(`ASHA${i + 1}`, `Competency ${i + 1}`));
const frac = {
  id: "f1", cadre: "ASHA", state: "Karnataka", size: "standard", prompt: "", postings: [], research: null, review: null,
  roles: [], competencies: twelve, rolesDirty: false, log: [], uploads: { competencies: "Competencies.xlsx" },
} as unknown as Frac;

const doc = (id: string, kind: FracDocument["kind"], filename: string, parsed: FracDocument["parsed"]): FracDocument =>
  ({ id, fracId: "f1", ownerId: "o", kind, filename, mime: "", bytes: 1, text: "", parsed, createdAt: "" });

const documents = [
  doc("d1", "competencies", "Competencies.xlsx", { counts: {}, warnings: [], competencies: twelve }),
  doc("d2", "dictionary", "GNM dictionary.xlsx", {
    counts: {}, warnings: [], postings: [{ key: "P1", label: "Sub-Centre" }],
    roles: [role("R1", "Conduct home visits", ["Visit newborns", "Counsel mothers"]), role("R2", "Maintain records", ["Update the RCH register"], 3)],
    competencies: [comp("GNM1", "Other")],
  }),
];

/** The agent's answer for "read only 5 competencies ASHA1 to ASHA5, and only the roles from the dictionary". */
const plan = feedbackAgentOutput.parse({
  summary: "Kept ASHA1–ASHA5 and took the dictionary's roles.",
  competencies: { change: true, items: ["ASHA1", "ASHA2", "ASHA3", "ASHA4", "ASHA5"].map((code) => ({ from: "D1", code })) },
  roles: { change: true, items: [{ from: "D2", code: "R1" }, { from: "D2", code: "R2" }] },
  mapping: [{ a: "D2:A1", c: "ASHA1", l: 3 }, { a: "D2:A2", c: "ASHA2", l: 4 }, { a: "D2:A1", c: "asha1", l: 3 }, { a: "D2:A3", c: "GNM1", l: 3 }],
});

describe("applyFeedbackPlan", () => {
  const sources = feedbackSources(frac, documents);
  const { patch, outcome } = applyFeedbackPlan(frac, sources, plan);

  it("keeps only the 5 competencies the agent picked, exactly as uploaded with their ladders", () => {
    expect(patch.competencies?.map((c) => c.code)).toEqual(["ASHA1", "ASHA2", "ASHA3", "ASHA4", "ASHA5"]);
    expect(patch.competencies?.[0]).toEqual(twelve[0]);
  });

  it("takes only the dictionary's roles, renumbered, with its postings, and maps them as the agent said", () => {
    expect(patch.roles?.map((r) => `${r.code} ${r.title}`)).toEqual(["R1 Conduct home visits", "R2 Maintain records"]);
    expect(patch.roles?.flatMap((r) => r.activities.map((a) => `${a.code} ${a.comp}`))).toEqual(["A1 ASHA1@L3", "A2 ASHA2@L4", "A3 "]);
    expect(patch.postings).toEqual([{ key: "P1", label: "Sub-Centre" }]);
    expect(patch.rolesDirty).toBe(true);
  });

  it("drops a mapping to a competency the FRAC will not have, and says so", () => {
    expect(outcome.notApplied.some((n) => n.reason.includes("GNM1"))).toBe(true);
    expect(outcome.applied).toEqual([
      "5 competencies (ASHA1, ASHA2, ASHA3, ASHA4, ASHA5) from Competencies.xlsx",
      "2 roles with 3 activities from GNM dictionary.xlsx",
      "mapped 2 of 3 activities to the competencies",
    ]);
    expect(outcome.changed).toEqual({ competencies: true, roles: true });
  });

  it("reports a row the sources do not have instead of inventing it", () => {
    const bad = feedbackAgentOutput.parse({ competencies: { change: true, items: [{ from: "D1", code: "ASHA99" }, { from: "D1", code: "ASHA1" }] } });
    const r = applyFeedbackPlan(frac, sources, bad);
    expect(r.patch.competencies?.map((c) => c.code)).toEqual(["ASHA1"]);
    expect(r.outcome.notApplied[0]).toEqual({ point: "Competency ASHA99", reason: "Not found in D1." });
  });

  it("keeps the agent's caveats apart from the points it did not carry out", () => {
    const r = applyFeedbackPlan(frac, sources, feedbackAgentOutput.parse({ notes: ["  ASHA competencies do not fit a GNM cadre "] }));
    expect(r.outcome.notes).toEqual(["ASHA competencies do not fit a GNM cadre"]);
    expect(r.outcome.notApplied).toEqual([]);
  });

  it("changes nothing when the agent leaves both sections alone", () => {
    const r = applyFeedbackPlan(frac, sources, feedbackAgentOutput.parse({ remaining: "Add the 104 helpline" }));
    expect(r.patch).toEqual({});
    expect(r.outcome.remaining).toBe("Add the 104 helpline");
  });
});

describe("stepAfterFeedback", () => {
  const outcome = (changed: FeedbackOutcome["changed"], remaining = ""): FeedbackOutcome =>
    ({ summary: "", applied: [], notApplied: [], notes: [], remaining, changed });

  it("runs the normal flow when there is no feedback, or the agent changed nothing", () => {
    expect(stepAfterFeedback("research", undefined, undefined)).toEqual({ run: true, feedback: undefined, guidance: undefined, notApplied: [] });
    expect(stepAfterFeedback("research", "Add X", undefined, outcome({ competencies: false, roles: false }, "Add X")).feedback).toBe("Add X");
  });

  it("does not run research again when the feedback was only about competencies and roles", () => {
    expect(stepAfterFeedback("research", "only 5", undefined, outcome({ competencies: true, roles: true })).run).toBe(false);
  });

  it("runs the step with only the feedback left over", () => {
    expect(stepAfterFeedback("research", "only 5; add 104", undefined, outcome({ competencies: true, roles: false }, "add 104")))
      .toEqual({ run: true, feedback: "add 104", notApplied: [] });
    expect(stepAfterFeedback("research", undefined, "only 5; add 104", outcome({ competencies: true, roles: false }, "add 104")))
      .toEqual({ run: true, guidance: "add 104", notApplied: [] });
  });

  it("never re-runs the step whose section the agent replaced, so the team's choice stays", () => {
    const r = stepAfterFeedback("competencies", "only 5, shorter", undefined, outcome({ competencies: true, roles: false }, "shorter"));
    expect(r.run).toBe(false);
    expect(r.notApplied[0].point).toBe("shorter");
  });
});

describe("runFeedbackAgent", () => {
  const ctx = (provider: TextProvider, feedback?: string): StepContext => ({
    frac, feedback, provider, progress: async () => undefined, recordUsage: async () => undefined,
    save: async (update) => ({ ...frac, ...update(frac) }),
  });

  it("makes no call without feedback or instructions", async () => {
    let calls = 0;
    const provider: TextProvider = { name: "claude", complete: async () => { calls++; throw new Error("no call expected"); } };
    expect(await runFeedbackAgent(ctx(provider), "research", documents)).toBeNull();
    expect(calls).toBe(0);
  });

  it("sends the feedback first with every source's rows, and saves the agent's choice", async () => {
    const prompts: string[] = [];
    const provider: TextProvider = {
      name: "claude",
      complete: async (req: CompletionRequest) => {
        prompts.push(req.prompt);
        return { json: plan, model: "m", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, costUsd: 0, estimated: true };
      },
    };
    const r = await runFeedbackAgent(ctx(provider, "Read only 5 competencies ASHA1 to ASHA5 and only the roles from the dictionary"), "research", documents);
    expect(prompts[0].startsWith("TEAM FEEDBACK: FIRST PRIORITY")).toBe(true);
    expect(prompts[0]).toContain("[D2] GNM dictionary.xlsx (dictionary)");
    expect(prompts[0]).toContain("ASHA12 | Competency 12");
    expect(r?.frac.competencies).toHaveLength(5);
    expect(r?.frac.roles).toHaveLength(2);
  });
});
