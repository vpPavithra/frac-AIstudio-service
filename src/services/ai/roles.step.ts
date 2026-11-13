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
import { mapToSheet } from "./competencies.step.ts";

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

type SizeTarget = (typeof SIZE_TARGETS)[keyof typeof SIZE_TARGETS];

/** 3b: activities for `roles` (default tier, BATCH.size roles per call, BATCH.parallel at once), as FracActivity rows without codes. */
async function writeActivities(ctx: StepContext, roles: { code: string; title: string }[], target: SizeTarget) {
  const { frac, feedback } = ctx;
  // No postings is allowed (the brief named none); activities then have no Yes/No values until the team adds some
  const postings = frac.postings.map((p) => p.key);
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
  return new Map(written.map(({ role, activities }) => [
    role.code,
    activities.map((a): FracActivity => ({ code: "", text: a.text.trim(), postings: a.postings, source: a.source, tier: a.tier, comp: "" })),
  ]));
}

/**
 * Whether the roles already on the FRAC are kept (fillGaps) instead of built from the research. A Roles sheet is
 * always kept. Roles copied from a matched position are kept only while no job description is attached: with one,
 * the roles come from the research and the document, not from another FRAC (review, Nov 2026).
 */
export function keepGivenRoles(frac: Frac, briefDocuments: number): boolean {
  if (!frac.roles.length) return false;
  if (frac.uploads?.roles) return true;
  return !!frac.seededFrom && frac.seededFrom.withRoles !== false && briefDocuments === 0;
}

/**
 * With a team's Competencies sheet (uploaded on the Research tab, review 13 Nov 2026) the competencies exist before
 * the roles, so the roles job ends by mapping the new activities to them (mapToSheet, one default-tier call). The
 * roles are saved first: a write that changes roles and mappings together leaves Competencies out of date
 * (step-changes.ts), while a mappings-only write stamps it. Without a sheet the patch is returned as it is.
 */
async function withSheetMapping(ctx: StepContext, patch: Partial<Frac>): Promise<Partial<Frac>> {
  if (!ctx.frac.uploads?.competencies || !ctx.frac.competencies.length) return patch;
  const saved = await ctx.save(() => patch);
  return mapToSheet({ ...ctx, frac: saved, feedback: undefined });
}

/**
 * Roles from a team's Roles sheet or a matched position (review decisions, Nov 2026): kept as they are, and
 * only the roles with no activities get them written (3b alone, no roles call). No AI call when every role has
 * activities. Competency mappings stay; new activities have none, so rolesDirty is set when competencies exist.
 */
async function fillGaps(ctx: StepContext): Promise<Partial<Frac>> {
  const { frac } = ctx;
  const empty = frac.roles.filter((r) => !r.activities.length);
  if (!empty.length) return { roles: renumberRoles(frac.roles) };
  const written = await writeActivities(ctx, empty.map((r) => ({ code: r.code, title: r.title })), SIZE_TARGETS[frac.size]);
  const roles = frac.roles.map((r) => (r.activities.length ? r : { ...r, activities: written.get(r.code) ?? [] }));
  return withSheetMapping(ctx, { roles: renumberRoles(roles), rolesDirty: frac.competencies.length > 0, review: null, reviewStale: false });
}

/**
 * Step 3, roles (complex, one call) then activities (default tier, BATCH.size roles per call, BATCH.parallel
 * calls at once). Afterwards: renumber, clear every competency@level, clear the review. Gap 2 fix (spec 10.2):
 * the competencies are kept and rolesDirty is set, instead of wiping them, so step 4 re-maps them.
 *
 * Kept on revise: activities with source ADDED_BY_TEAM, re-attached to the role with the same title
 * (case-insensitive); a renamed role loses them. Earlier model-written activities are only offered to the
 * model as "keep the good ones" (activitiesPrompt). Throws AI_OUTPUT_INVALID on a malformed answer.
 *
 * Roles from a Roles sheet, or from a matched position when no job description is attached, are kept
 * (keepGivenRoles, fillGaps) unless the team asks for a revise with feedback, which rebuilds them as above.
 */
export async function runRoles(ctx: StepContext): Promise<Partial<Frac>> {
  const { frac, feedback } = ctx;
  const briefDocuments = (ctx.documents ?? []).filter((d) => d.kind === "brief").length;
  if (!feedback && keepGivenRoles(frac, briefDocuments)) return fillGaps(ctx);
  const target = SIZE_TARGETS[frac.size];

  await ctx.progress(JOB_MESSAGES.roles);
  const drafted = await callModel(ctx, "roles", "complex", rolesPrompt(frac, target.roles, feedback),
    { cadre: frac.cadre, state: frac.state, scope: frac.prompt, count: target.roles, feedback }, rolesOutput);
  const roles = drafted.roles.map((r, i) => ({ code: `R${i + 1}`, title: r.title.trim(), source: r.source }));
  const written = await writeActivities(ctx, roles, target);

  // Team-typed activities from the FRAC as it was when the job started, found by role title
  const teamAdded = (title: string): FracActivity[] =>
    frac.roles.find((r) => r.title.toLowerCase() === title.toLowerCase())?.activities.filter((a) => a.source === ADDED_BY_TEAM) ?? [];
  const built: FracRole[] = roles.map((role) => ({
    ...role,
    activities: [...(written.get(role.code) ?? []), ...teamAdded(role.title).map((a) => ({ ...a, comp: "" }))],
  }));

  // Copied roles, if any, are replaced now
  const seededFrom = frac.seededFrom ? { seededFrom: { ...frac.seededFrom, withRoles: false } } : {};
  return withSheetMapping(ctx, { roles: renumberRoles(built), ...seededFrom, rolesDirty: frac.competencies.length > 0, review: null, reviewStale: false });
}
