// CREATOR STEP 2, job research (spec 5.2). Runs as a job started by FracService.startStep("research").
// One complex-tier call (Kaushal); when the provider profile has webSearch it may also search the
// government domains in RESEARCH_SEARCH_DOMAINS (see providers/text/claude.ts, gemini.ts). The answer is validated against researchOutput,
// then researchPatch turns it into the FRAC's research, postings, cadreFull and codePrefix.
// Flow: brief -> research -> roles & activities -> competencies -> ladders -> expert check.
import type { z } from "zod";
import type { Frac } from "../../models/frac.model.ts";
import { sanitizeCodePrefix } from "../../utils/codes.ts";
import { researchPrompt } from "./prompts.ts";
import { researchOutput } from "./schemas.ts";
import { callModel, type StepContext } from "./step-context.ts";

/** Spec 5.2: at most 3 postings (the FRAC's columns). A spec rule, so it stays in code. */
const MAX_POSTINGS = 3;

/**
 * Spec 5.2 post-processing: sanitise codePrefix; keep at most 3 postings re-keyed P1..P3 (fallback
 * one posting named after the cadre); join the lists into newline text; prefix each `verify` item
 * with "VERIFY: " and append it to the assumptions.
 * Pure: the result is merged into the latest saved FRAC by FracService.startStep. A blank cadreFull or
 * codePrefix falls back to the brief's values. On revise everything here is replaced; the team's edits
 * reach the model only through the PREVIOUS RESEARCH block in the prompt.
 */
export function researchPatch(frac: Frac, out: z.infer<typeof researchOutput>): Partial<Frac> {
  const labels = out.postings.map((p) => p.label.trim()).filter(Boolean).slice(0, MAX_POSTINGS);
  const postings = (labels.length ? labels : [frac.cadre]).map((label, i) => ({ key: `P${i + 1}`, label }));
  const assumptions = [...out.assumptions, ...out.verify.map((v) => `VERIFY: ${v}`)];
  return {
    cadreFull: out.cadreFull.trim() || frac.cadreFull,
    codePrefix: sanitizeCodePrefix(out.codePrefix || frac.cadre),
    postings,
    research: {
      summary: out.summary,
      sourceNotes: out.sourceNotes,
      sources: out.sources,
      authorised: out.authorised.join("\n"),
      notAuthorised: out.notAuthorised.join("\n"),
      stateContext: out.stateContext.join("\n"),
      assumptions: assumptions.join("\n"),
    },
  };
}

/**
 * Step 2, job research (Kaushal), complex tier, one call. `input` is what the mock answers from;
 * Real providers read only the prompt. Throws AI_OUTPUT_INVALID (via callModel) when the answer has the wrong shape.
 */
export async function runResearch(ctx: StepContext): Promise<Partial<Frac>> {
  const { frac, feedback } = ctx;
  const out = await callModel(ctx, "research", "complex", researchPrompt(frac, feedback),
    { cadre: frac.cadre, state: frac.state, size: frac.size, scope: frac.prompt, feedback }, researchOutput);
  return researchPatch(frac, out);
}
