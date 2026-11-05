import type { z } from "zod";
import type { Frac } from "../../models/frac.model.ts";
import { sanitizeCodePrefix } from "../../utils/codes.ts";
import { researchPrompt } from "./prompts.ts";
import { researchOutput } from "./schemas.ts";
import { callModel, type StepContext } from "./step-context.ts";

const MAX_POSTINGS = 3;

/**
 * Spec 5.2 post-processing: sanitise codePrefix; keep at most 3 postings re-keyed P1..P3 (fallback
 * one posting named after the cadre); join the lists into newline text; prefix each `verify` item
 * with "VERIFY: " and append it to the assumptions.
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

/** Step 2, job research (Kaushal), complex tier, one call. */
export async function runResearch(ctx: StepContext): Promise<Partial<Frac>> {
  const { frac, feedback } = ctx;
  const out = await callModel(ctx, "research", "complex", researchPrompt(frac, feedback),
    { cadre: frac.cadre, state: frac.state, size: frac.size, scope: frac.prompt, feedback }, researchOutput);
  return researchPatch(frac, out);
}
