import { ChecklistReviewer, locateQuote, normaliseQuote } from "./ai-review.service.ts";
import { loadReviewRules } from "../config/review-rules.ts";
import { computeChecks } from "./review-engine/checks.ts";
import { comp, model } from "../../test/support/test-data.ts";
import type { CompletionRequest, TextProvider } from "../providers/text/types.ts";

const RULES = loadReviewRules();

/** Answers each task from a fixed table and records the calls. */
function provider(answers: Record<string, unknown>): TextProvider & { calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  return {
    name: "stub",
    calls,
    async complete(req) {
      calls.push(req);
      return { json: answers[req.task], model: "stub", usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0 };
    },
  };
}

describe("quote check (rules r3 §6.3)", () => {
  it("normalises case, quotes, dashes and punctuation", () => {
    expect(normaliseQuote(`"Gives  IV—fluids, as per 'protocol'!"`)).toBe("gives iv fluids as per protocol");
  });

  it("finds the level holding the quote and rejects paraphrases and short quotes", () => {
    const m = model();
    expect(locateQuote("handles complications - coordinates referral", m, "C1")).toBe(4);
    expect(locateQuote("manages the complications and refers", m, "C1")).toBeNull();
    expect(locateQuote("Audits records", m, "C1")).toBeNull();
  });
});

describe("ChecklistReviewer", () => {
  it("keeps verified flags, drops duplicates of rule-based hits, and merges into three fixed findings", async () => {
    const c1 = comp("C1", "Domain");
    c1.levels[3].desc = "Prescribes antibiotics for sepsis\n- Gives oxytocin 10 IU IM after birth to every woman";
    const m = model({ competencies: [c1, comp("C2", "Functional"), comp("C3", "Behavioural")] });
    const checks = computeChecks(m, RULES, { cadre: "ANM" });
    const p = provider({
      "review-competencies": {
        items: [
          {
            code: "C1",
            scope: [
              { quote: "Prescribes antibiotics for sepsis", act: "Prescribing", basis: "MO only" }, // code already hit C1 L4
              { quote: "Handles complications in a way not in the file", act: "x", basis: "y" }, // not in the text
            ],
            accuracy: [{ quote: "Gives oxytocin 10 IU IM after birth", issue: "Dose stated without AMTSL context", correct: "Oxytocin 10 IU IM within 1 minute (AMTSL)" }],
          },
        ],
      },
      "review-state": { items: [{ category: "State schemes", item: "Add Mukhyamantri schemes (verify).", refs: ["C1"] }, { category: "Weather", item: "x", refs: [] }] },
    });
    const findings = await new ChecklistReviewer(p).review({ model: m, cadre: "ANM", state: "Bihar", checks, rules: RULES });

    expect(p.calls.map((c) => c.task)).toEqual(["review-competencies", "review-state"]);
    expect(p.calls[0].prompt).toContain("do NOT repeat");
    expect(findings.map((f) => [f.title, f.sev, f.source])).toEqual([
      ["Clinical or programme facts to correct", "M", "agent"],
      ["Does not reflect Bihar", "m", "agent"],
    ]);
    expect(findings[0].detail).toBe('C1 L4: "Gives oxytocin 10 IU IM after birth" — Dose stated without AMTSL context');
    expect(findings[0].fix).toBe("C1 L4: Oxytocin 10 IU IM within 1 minute (AMTSL)");
    expect(findings[1].detail).toBe("State schemes: Add Mukhyamantri schemes (verify).");
  });

  it("skips the state call for the national baseline and batches 6 competencies per call", async () => {
    const comps = Array.from({ length: 7 }, (_, i) => comp(`C${i + 1}`, "Domain"));
    const m = model({ competencies: comps });
    const p = provider({ "review-competencies": { items: [] } });
    const findings = await new ChecklistReviewer(p).review({ model: m, cadre: "ANM", state: "India (national baseline)", checks: computeChecks(m, RULES), rules: RULES });
    expect(findings).toEqual([]);
    expect(p.calls.map((c) => c.task)).toEqual(["review-competencies", "review-competencies"]);
  });

  it("drops a flag a config ladder rule already covers, only for cadres that rule applies to", async () => {
    // supervising-l3 is frontlineOnly with suppressesAiFlags: it covers ANM, not a Medical Officer
    const c1 = comp("C1", "Domain");
    c1.levels[2].desc = "Supervises and mentors junior staff during sessions";
    const m = model({ competencies: [c1, comp("C2", "Functional"), comp("C3", "Behavioural")] });
    const answer = {
      "review-competencies": {
        items: [{ code: "C1", scope: [{ quote: "Supervises and mentors junior staff during sessions", act: "Supervising", basis: "x" }], accuracy: [] }],
      },
    };
    const run = (cadre: string) =>
      new ChecklistReviewer(provider(answer)).review({ model: m, cadre, checks: computeChecks(m, RULES, { cadre }), rules: RULES });

    expect(await run("ANM")).toEqual([]);
    expect((await run("Medical Officer")).map((f) => f.title)).toEqual(["Other acts beyond Medical Officer scope"]);
  });

  it("fails the job with AI_OUTPUT_INVALID on a bad shape", async () => {
    const m = model();
    const p = provider({ "review-competencies": { items: "nope" } });
    await expect(new ChecklistReviewer(p).review({ model: m, cadre: "ANM", checks: computeChecks(m, RULES), rules: RULES })).rejects.toMatchObject({ code: "AI_OUTPUT_INVALID" });
  });
});
