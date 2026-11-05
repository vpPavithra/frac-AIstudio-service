import type { FracSize } from "../../models/frac.model.ts";

/** Spec 5.1 brief sizes: the ranges go into prompts, the targets are what a step asks for. */
export const SIZE_TARGETS: Record<FracSize, { roles: number; acts: number; comps: number; ranges: string }> = {
  compact: { roles: 7, acts: 5, comps: 18, ranges: "6–8 roles, 4–6 activities per role, 16–22 competencies" },
  standard: { roles: 12, acts: 6, comps: 32, ranges: "10–14 roles, 5–8 activities per role, 28–40 competencies" },
  full: { roles: 17, acts: 7, comps: 50, ranges: "15–19 roles, 6–9 activities per role, 45–60 competencies" },
};

/** Spec 5.3b / 5.5: items per model call and calls in flight at once. */
export const BATCH = { size: 4, parallel: 3 } as const;
