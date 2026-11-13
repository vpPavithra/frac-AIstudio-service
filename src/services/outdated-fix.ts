// OUTDATED NAMES, fixed without AI (review, 13 Nov 2026): the expert check's "Outdated reference: X" findings come from
// config/outdated.json, which already names the current reference, so "Replace with VHSND" is a plain text replace in
// activities and in competency names, descriptions and ladders (the same texts the check reads). Patterns that need
// content added rather than a name swapped (onlyIfAbsent, or their own fix text) are not replaceable. Pure, no I/O.
import type { Frac } from "../models/frac.model.ts";
import type { OutdatedPattern } from "./review-engine/rules.ts";

/** Characters either side of a hit that unlessNear looks at; the same window as the check (checks.ts NEAR_WINDOW). */
const NEAR_WINDOW = 80;

/** The finding title the check gives this pattern. */
export const outdatedTitle = (p: OutdatedPattern) => `Outdated reference: ${p.found}`;

/** The pattern can be fixed by swapping the name: it has no content rule and no fix text of its own. */
export const replaceable = (p: OutdatedPattern) => !p.onlyIfAbsent && !p.fix;

/** The name to write in: the current reference without a trailing year note, so "Td (2018)" writes "Td". */
export const replacementFor = (p: OutdatedPattern) => p.correct.replace(/\s*\(\d{4}\)\s*$/, "").trim();

/**
 * `frac` with every hit of the pattern replaced, and how many were replaced. Hits the check would skip (within
 * NEAR_WINDOW of unlessNear) are left as they are.
 */
export function replaceOutdated(frac: Frac, p: OutdatedPattern): { frac: Frac; replaced: number } {
  const re = new RegExp(p.pattern, p.flags.includes("g") ? p.flags : `${p.flags}g`);
  const near = p.unlessNear ? new RegExp(p.unlessNear, "i") : null;
  const value = replacementFor(p);
  let replaced = 0;
  const fix = (text: string) =>
    text.replace(re, (match: string, ...rest: unknown[]) => {
      const at = rest.find((x): x is number => typeof x === "number") ?? 0;
      if (near && near.test(text.slice(Math.max(0, at - NEAR_WINDOW), at + match.length + NEAR_WINDOW))) return match;
      replaced++;
      return value;
    });
  const next: Frac = {
    ...frac,
    roles: frac.roles.map((r) => ({ ...r, activities: r.activities.map((a) => ({ ...a, text: fix(a.text) })) })),
    competencies: frac.competencies.map((c) => ({
      ...c,
      label: fix(c.label),
      description: fix(c.description),
      levels: c.levels ? c.levels.map((l) => ({ label: fix(l.label), desc: fix(l.desc) })) : null,
    })),
  };
  return { frac: next, replaced };
}
