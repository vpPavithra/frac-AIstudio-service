// Loader for config/frac-sizes.json: how many roles, activities per role and competencies each brief
// size ("compact" | "standard" | "full") asks the AI for. Called once, at import, by
// services/ai/sizes.ts (SIZE_TARGETS). The path comes from PATHS.fracSizes (FRAC_SIZES_CONFIG_PATH).
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FracSize } from "../models/frac.model.ts";
import { FRAC_SIZES } from "../validations/frac.schema.ts";
import { PATHS } from "./constants.ts";
import { SettingsError } from "./settings.ts";

/** What one brief size asks each step for (spec 5.1). */
export interface SizeTarget {
  /** Roles to draft in the roles step. */
  roles: number;
  /** Activities per role. */
  acts: number;
  /** Competencies to draft in the competencies step. */
  comps: number;
  /** The ranges as worded in every prompt, e.g. "6–8 roles, 4–6 activities per role, 16–22 competencies". */
  ranges: string;
}

const isCount = (n: unknown) => Number.isInteger(n) && (n as number) > 0;

/**
 * Reads the size targets from config/frac-sizes.json (or FRAC_SIZES_CONFIG_PATH) at startup, so the
 * numbers can be tuned without a deploy. Every size the portal offers must be present with positive
 * whole numbers; anything else stops startup rather than running with a half-read table.
 * Throws SettingsError on a missing or bad entry (a JSON syntax error throws SyntaxError).
 */
export function loadFracSizes(file = path.resolve(process.cwd(), PATHS.fracSizes)): Record<FracSize, SizeTarget> {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, Partial<SizeTarget>>;
  const out = {} as Record<FracSize, SizeTarget>;
  for (const size of FRAC_SIZES) {
    const t = parsed[size];
    if (!t || !isCount(t.roles) || !isCount(t.acts) || !isCount(t.comps) || typeof t.ranges !== "string" || !t.ranges.trim()) {
      throw new SettingsError(`${file}: "${size}" needs whole numbers roles, acts and comps above 0 and a ranges sentence.`);
    }
    out[size] = { roles: t.roles as number, acts: t.acts as number, comps: t.comps as number, ranges: t.ranges };
  }
  return out;
}
