// STEP CHANGES: when each Creator step's content last changed, so the portal can mark later steps "Needs attention"
// after the team goes back and changes an earlier one (a hand edit, an AI run or a sheet upload).
// stampChanges runs on every FRAC write in frac.service.ts and document.service.ts. Pure, no I/O.
import type { Frac, FracStep } from "../models/frac.model.ts";

/** The steps in flow order: a step is out of date when any step before it changed after it. */
export const FRAC_STEPS: readonly FracStep[] = ["brief", "research", "roles", "competencies", "ladders"];

// cadreFull is left out: research rewrites it, and that is not a brief change
const brief = (f: Frac) => JSON.stringify([f.cadre, f.state, f.prompt]);
const research = (f: Frac) => JSON.stringify([f.research, f.postings]);
const roles = (f: Frac) => JSON.stringify(f.roles.map((r) => ({ ...r, activities: r.activities.map(({ comp: _comp, ...a }) => a) })));
const competencies = (f: Frac) => JSON.stringify(f.competencies.map(({ levels: _levels, ...c }) => c));
const mappings = (f: Frac) => JSON.stringify(f.roles.map((r) => r.activities.map((a) => a.comp)));

/** Ladders count as changed only when levels are written: clearing them (a re-derive) leaves nothing to check. */
function laddersWritten(prev: Frac, next: Frac): boolean {
  const before = new Map(prev.competencies.map((c) => [c.code, JSON.stringify(c.levels)]));
  return next.competencies.some((c) => c.levels !== null && before.get(c.code) !== JSON.stringify(c.levels));
}

/**
 * `next` with `changedAt` set to `at` for every step whose content differs from `prev`. Mappings belong to the
 * competencies step, but not when the roles changed in the same write: a roles rebuild drops mappings of new
 * activities, and that must leave competencies out of date, not mark them current.
 */
export function stampChanges(prev: Frac, next: Frac, at: string): Frac {
  const rolesChanged = roles(prev) !== roles(next);
  const changes: Record<FracStep, boolean> = {
    brief: brief(prev) !== brief(next),
    research: research(prev) !== research(next),
    roles: rolesChanged,
    competencies: competencies(prev) !== competencies(next) || (!rolesChanged && mappings(prev) !== mappings(next)),
    ladders: laddersWritten(prev, next),
  };
  const changed = FRAC_STEPS.filter((step) => changes[step]);
  if (!changed.length) return next;
  return { ...next, changedAt: { ...next.changedAt, ...Object.fromEntries(changed.map((step) => [step, at])) } };
}

/**
 * `frac` with `step` stamped now: the team marked it checked (the earlier change does not affect it), or it
 * changed outside the FRAC document (a brief document added or removed).
 */
export function markChecked(frac: Frac, step: FracStep, at: string): Frac {
  return { ...frac, changedAt: { ...frac.changedAt, [step]: at } };
}
