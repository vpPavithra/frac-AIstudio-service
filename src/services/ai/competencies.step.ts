import type { z } from "zod";
import type { Frac, FracCompetency } from "../../models/frac.model.ts";
import { ApiError } from "../../utils/response.ts";
import { JOB_MESSAGES } from "../queue/job-messages.ts";
import { competenciesPrompt } from "./prompts.ts";
import { competenciesOutput } from "./schemas.ts";
import { SIZE_TARGETS } from "./sizes.ts";
import { callModel, type StepContext } from "./step-context.ts";

/**
 * Spec 5.4 post-processing: write activity.comp = "c@Ll"; keep a competency's ladder only when both
 * its code and its label are unchanged (otherwise null, so step 5 rewrites it); clear the review and
 * rolesDirty. A mapping that names an unknown activity or competency fails the step.
 */
export function competenciesPatch(frac: Frac, out: z.infer<typeof competenciesOutput>): Partial<Frac> {
  const codes = new Set(out.competencies.map((c) => c.code));
  const byActivity = new Map<string, string>();
  for (const m of out.mapping) {
    if (!codes.has(m.c)) throw new ApiError(502, "AI_OUTPUT_INVALID", `The mapping names an unknown competency ${m.c}.`);
    byActivity.set(m.a, `${m.c}@L${m.l}`);
  }
  const previous = new Map(frac.competencies.map((c) => [c.code, c]));
  const competencies: FracCompetency[] = out.competencies.map((c) => {
    const old = previous.get(c.code);
    const keepLadder = old && old.label.trim().toLowerCase() === c.label.trim().toLowerCase();
    return { ...c, levels: keepLadder ? old.levels : null };
  });
  const roles = frac.roles.map((r) => ({ ...r, activities: r.activities.map((a) => ({ ...a, comp: byActivity.get(a.code) ?? "" })) }));
  return { competencies, roles, rolesDirty: false, review: null };
}

/** Step 4, competencies (Kaushal), complex tier, one call; derived last, from the activities. */
export async function runCompetencies(ctx: StepContext): Promise<Partial<Frac>> {
  const { frac, feedback } = ctx;
  const count = SIZE_TARGETS[frac.size].comps;
  await ctx.progress(JOB_MESSAGES.competencies);
  const activities = frac.roles.flatMap((r) => r.activities.map((a) => ({ code: a.code, text: a.text })));
  const out = await callModel(ctx, "competencies", "complex", competenciesPrompt(frac, count, feedback),
    { cadre: frac.cadre, scope: frac.prompt, prefix: frac.codePrefix || "C", count, activities, existing: frac.competencies.map((c) => c.code), feedback },
    competenciesOutput);
  return competenciesPatch(frac, out);
}
