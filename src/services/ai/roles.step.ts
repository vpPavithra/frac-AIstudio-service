// CREATOR STEP 3, roles and activities (spec 5.3). Runs as a job started by FracService.startStep("roles").
// 3a: one complex-tier call drafts the roles. 3b: default-tier calls write the activities, AI.stepBatchSize
// roles per call with AI.stepParallel calls at once (AI_BATCH_SIZE, AI_BATCH_PARALLEL). Counts come from the
// brief size (config/frac-sizes.json). Activities are saved once, at the end, not per batch.
// Flow: brief -> research -> roles & activities -> competencies -> ladders -> expert check.
import type { Frac, FracActivity, FracRole } from "../../models/frac.model.ts";
import { JOB_MESSAGES } from "../queue/job-messages.ts";
import { runInBatches } from "./batching.ts";
import { activitiesPrompt, rolesPrompt } from "./prompts.ts";
import { activitiesOutput, rolesOutput } from "./schemas.ts";
import { BATCH, SIZE_TARGETS } from "./sizes.ts";
import { callModel, type StepContext } from "./step-context.ts";

/** Source label for activities the team typed in; kept across a revise (spec 5.3 "keep what the team edited"). */
export const ADDED_BY_TEAM = "Added by team";

/**
 * Re-codes roles R1..Rn and activities A1..An, numbered globally across roles (spec 5.3). Codes are
 * positional, so any re-run renumbers; competency mappings (`comp`) are cleared by the caller for that reason.
 */
export function renumberRoles(roles: FracRole[]): FracRole[] {
  let seq = 0;
  return roles.map((role, r) => ({
    ...role,
    code: `R${r + 1}`,
    activities: role.activities.map((a) => ({ ...a, code: `A${++seq}` })),
  }));
}

/**
 * Step 3, roles (complex, one call) then activities (default tier, BATCH.size roles per call, BATCH.parallel
 * calls at once). Afterwards: renumber, clear every competency@level, clear the review. Gap 2 fix (spec 10.2):
 * the competencies are kept and rolesDirty is set, instead of wiping them, so step 4 re-maps them.
 *
 * Kept on revise: activities with source ADDED_BY_TEAM, re-attached to the role with the same title
 * (case-insensitive); a renamed role loses them. Earlier model-written activities are only offered to the
 * model as "keep the good ones" (activitiesPrompt). Throws AI_OUTPUT_INVALID on a malformed answer.
 */
export async function runRoles(ctx: StepContext): Promise<Partial<Frac>> {
  const { frac, feedback } = ctx;
  const target = SIZE_TARGETS[frac.size];

  await ctx.progress(JOB_MESSAGES.roles);
  const drafted = await callModel(ctx, "roles", "complex", rolesPrompt(frac, target.roles, feedback),
    { cadre: frac.cadre, state: frac.state, scope: frac.prompt, count: target.roles, feedback }, rolesOutput);
  const roles = drafted.roles.map((r, i) => ({ code: `R${i + 1}`, title: r.title.trim(), source: r.source }));

  // An imported FRAC may have no postings yet; ask for one column so every activity still gets a Yes/No
  const postings = frac.postings.length ? frac.postings.map((p) => p.key) : ["P1"];
  await ctx.progress(JOB_MESSAGES.activities(roles.length), 0, roles.length);
  const written = await runInBatches(
    roles,
    BATCH.size,
    BATCH.parallel,
    async (batch) => {
      const out = await callModel(ctx, "activities", "default", activitiesPrompt(frac, batch, target.acts, feedback),
        { cadre: frac.cadre, roles: batch, postings, count: target.acts, feedback }, activitiesOutput);
      // Matched by role code; a role the model skipped gets no activities rather than failing the step
      return batch.map((role) => ({ role, activities: out.roles.find((r) => r.code === role.code)?.activities ?? [] }));
    },
    (_, done) => ctx.progress(JOB_MESSAGES.activities(roles.length), done, roles.length),
  );

  // Team-typed activities from the FRAC as it was when the job started, found by role title
  const teamAdded = (title: string): FracActivity[] =>
    frac.roles.find((r) => r.title.toLowerCase() === title.toLowerCase())?.activities.filter((a) => a.source === ADDED_BY_TEAM) ?? [];
  const built: FracRole[] = written.map(({ role, activities }) => ({
    ...role,
    activities: [
      ...activities.map((a) => ({ code: "", text: a.text.trim(), postings: a.postings, source: a.source, tier: a.tier, comp: "" })),
      ...teamAdded(role.title).map((a) => ({ ...a, comp: "" })),
    ],
  }));

  return { roles: renumberRoles(built), rolesDirty: frac.competencies.length > 0, review: null };
}
