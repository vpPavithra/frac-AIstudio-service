// Loader for the review engine's (r3) rule tables: config/review-rules.json (REVIEW_RULES_CONFIG_PATH)
// plus the OUTDATED list from config/outdated.json. server.ts hands loadReviewRules to ReviewService
// as a function, so both files are re-read for every review and edits apply without a restart.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReviewRules } from "../services/review-engine/rules.ts";
import { PATHS } from "./constants.ts";
import { loadOutdatedPatterns } from "./outdated.ts";

/**
 * Reads the r3 rule tables (scope, ladder rules, job areas) plus the OUTDATED list at runtime, so
 * clinical reviewers can extend them without a deploy. Override the location with
 * REVIEW_RULES_CONFIG_PATH (e.g. a mounted ConfigMap).
 */
export function loadReviewRules(file = path.resolve(process.cwd(), PATHS.reviewRules)): ReviewRules {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Omit<ReviewRules, "outdated">;
  return { scope: parsed.scope, ladder: parsed.ladder, areas: parsed.areas, outdated: loadOutdatedPatterns() };
}
