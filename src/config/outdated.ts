import { readFileSync } from "node:fs";
import path from "node:path";
import type { OutdatedPattern } from "../engine/checks.js";
import { PATHS } from "./constants.js";

/**
 * Reads the OUTDATED list at runtime so clinical reviewers can extend it without a deploy.
 * Override the location with OUTDATED_CONFIG_PATH (e.g. a mounted ConfigMap).
 */
export function loadOutdatedPatterns(file = path.resolve(process.cwd(), PATHS.outdated)): OutdatedPattern[] {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { patterns: OutdatedPattern[] };
  return parsed.patterns;
}
