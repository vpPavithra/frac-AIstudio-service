// Loader for config/outdated.json (or OUTDATED_CONFIG_PATH): the OUTDATED list of superseded laws and
// programme names the review engine flags (rules r3 §4.5). Called by config/review-rules.ts on every review.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { OutdatedPattern } from "../services/review-engine/checks.ts";
import { PATHS } from "./constants.ts";

/**
 * Reads the OUTDATED list at runtime so clinical reviewers can extend it without a deploy.
 * Override the location with OUTDATED_CONFIG_PATH (e.g. a mounted ConfigMap). The shape is not
 * validated here; a missing file or bad JSON throws, which fails that review's job.
 */
export function loadOutdatedPatterns(file = path.resolve(process.cwd(), PATHS.outdated)): OutdatedPattern[] {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { patterns: OutdatedPattern[] };
  return parsed.patterns;
}
