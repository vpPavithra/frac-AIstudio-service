// CREATOR STEP: competencies (spec 5.4). Runs as a job started by FracService.startStep("competencies").
// Competencies come before roles (16 Nov 2026): after research, one complex-tier call derives the competencies the job
// needs from the research and the team's documents; the roles job then maps every activity to them. A team's
// Competencies sheet replaces that call. The count comes from the brief size (config/frac-sizes.json via sizes.ts).
// Flow: brief -> research -> competencies -> roles & activities -> ladders -> expert check.
import type { z } from "zod/v4";
import type { Frac, FracCompetency } from "../../models/frac.model.ts";
import { ApiError } from "../../utils/response.ts";
import { JOB_MESSAGES } from "../queue/job-messages.ts";
import { competenciesFromResearchPrompt, competenciesPrompt, mappingPrompt } from "./prompts.ts";
import { competenciesOnlyOutput, competenciesOutput, mappingOutput } from "./schemas.ts";
import { SIZE_TARGETS } from "./sizes.ts";
import { callModel, type StepContext } from "./step-context.ts";

/**
 * Spec 5.4 post-processing: write activity.comp = "c@Ll"; keep a competency's ladder only when both
 * its code and its label are unchanged (otherwise null, so step 5 rewrites it); clear the review and
 * rolesDirty. A mapping that names an unknown competency fails the step with AI_OUTPUT_INVALID; a mapping
 * for an unknown activity code is ignored, and an activity the model left out gets an empty `comp`.
 * The label comparison ignores case and surrounding spaces. This is what is kept on revise: ladders of
 * competencies whose code and label survived. The prompt asks the model to keep existing codes.
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
  return { competencies, roles, rolesDirty: false, review: null, reviewStale: false };
}

/**
 * Step 4 with a team's Competencies sheet (review decisions, Nov 2026): the competencies are kept as uploaded
 * and one default-tier call only maps the activities to them. competenciesPatch keeps every uploaded ladder,
 * because codes and labels are unchanged. Also the last part of the roles job when the sheet came first (roles.step.ts).
 */
export async function mapToSheet(ctx: StepContext): Promise<Partial<Frac>> {
  const { frac, feedback } = ctx;
  await ctx.progress(JOB_MESSAGES.mapping);
  const activities = frac.roles.flatMap((r) => r.activities.map((a) => ({ code: a.code, text: a.text })));
  const out = await callModel(ctx, "mapping", "default", mappingPrompt(frac, feedback),
    { cadre: frac.cadre, activities, competencies: frac.competencies.map((c) => ({ code: c.code, label: c.label, description: c.description })), feedback },
    mappingOutput);
  return competenciesPatch(frac, { competencies: frac.competencies.map(({ levels: _levels, ...c }) => c), mapping: out.mapping });
}

/**
 * Competencies before roles: written from the research, with no mappings yet. A ladder survives only when its
 * competency keeps both code and label (as in competenciesPatch). The review is cleared: the content changed.
 */
export function researchCompetenciesPatch(frac: Frac, out: z.infer<typeof competenciesOnlyOutput>): Partial<Frac> {
  const previous = new Map(frac.competencies.map((c) => [c.code, c]));
  const competencies: FracCompetency[] = out.competencies.map((c) => {
    const old = previous.get(c.code);
    const keepLadder = old && old.label.trim().toLowerCase() === c.label.trim().toLowerCase();
    return { ...c, levels: keepLadder ? old.levels : null };
  });
  return { competencies, rolesDirty: false, review: null, reviewStale: false };
}

/**
 * The competencies step (Kaushal). Which call it makes:
 * 1. a team's Competencies sheet → map the activities to it only (mapToSheet; nothing to map before roles);
 * 2. no activities yet (the usual case, competencies first) → derive them from the research and documents;
 * 3. activities but no competencies, or a revise with feedback → derive them and map every activity in one call;
 * 4. activities and competencies, no feedback, and the competencies are current with the research (activities changed
 *    after mapping: "Map activities to competencies") → map only, competencies unchanged. When research changed after
 *    them, the same click re-derives them (3).
 * Codes use the FRAC's codePrefix, or "C" before research has set one.
 */
export async function runCompetencies(ctx: StepContext): Promise<Partial<Frac>> {
  const { frac, feedback } = ctx;
  const hasActivities = frac.roles.some((r) => r.activities.length);
  if (frac.uploads?.competencies && frac.competencies.length) return hasActivities ? mapToSheet(ctx) : {};
  const count = SIZE_TARGETS[frac.size].comps;
  if (!hasActivities) {
    await ctx.progress(JOB_MESSAGES.competencies);
    const docs = (ctx.documents ?? []).filter((d) => d.kind === "brief").map((d) => ({ name: d.filename, text: d.text }));
    const out = await callModel(ctx, "competencies", "complex", competenciesFromResearchPrompt(frac, count, docs, feedback),
      { cadre: frac.cadre, scope: frac.prompt, prefix: frac.codePrefix || "C", count, activities: [], existing: frac.competencies.map((c) => c.code), feedback },
      competenciesOnlyOutput);
    return researchCompetenciesPatch(frac, out);
  }
  const current = (frac.changedAt?.competencies ?? "") >= (frac.changedAt?.research ?? "");
  if (frac.competencies.length && !feedback && (frac.rolesDirty || current)) return mapToSheet(ctx);
  await ctx.progress(JOB_MESSAGES.competencies);
  const activities = frac.roles.flatMap((r) => r.activities.map((a) => ({ code: a.code, text: a.text })));
  const out = await callModel(ctx, "competencies", "complex", competenciesPrompt(frac, count, feedback),
    { cadre: frac.cadre, scope: frac.prompt, prefix: frac.codePrefix || "C", count, activities, existing: frac.competencies.map((c) => c.code), feedback },
    competenciesOutput);
  return competenciesPatch(frac, out);
}
