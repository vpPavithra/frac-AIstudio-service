// `npm run config:check`: fails CI when config/service.json would break or silently mislead.
// Checks: valid JSON, no secrets, UPPER_SNAKE names (readSettingsFile), every key known to
// constants.ts (a typo would otherwise be ignored and the code default used), and numbers that
// parse. Prints the resolved non-secret settings. Reads config/service.json and service.<NODE_ENV>.json;
// it does not check config/frac-sizes.json, review-rules.json or outdated.json (those are checked when loaded).
import path from "node:path";
import { readSettingsFile, SettingsError } from "../config/settings.ts";

/** Setting names whose value must parse as a number, recognised by suffix/prefix (e.g. LLM_TIMEOUT_MS, MAX_ROLES). */
const NUMERIC = /(_MS|_MB|_CHARS|_RETRIES|_USD_PER_1M|_USD_PER_1K|_MULTIPLIER|_TOKENS|_RESUMES|_USES|_SIZE|_PARALLEL|_ITEMS|_WORDS|^MAX_|^PORT$|_TEMPERATURE$)/;

/** Runs every check and returns the exit code (0 OK, 1 problems), so all problems print in one run. */
async function main(): Promise<number> {
  const configDir = path.resolve(process.cwd(), "config");
  const files = ["service.json", ...(process.env.NODE_ENV ? [`service.${process.env.NODE_ENV}.json`] : [])];
  // Imported lazily: loading constants.ts applies service.json, which would throw before we could report on it
  const { KNOWN_SETTINGS, ...groups } = await import("../config/constants.ts");
  const known = new Set<string>(KNOWN_SETTINGS);
  const problems: string[] = [];

  for (const name of files) {
    for (const [key, value] of readSettingsFile(path.join(configDir, name))) {
      if (!known.has(key)) problems.push(`${name}: unknown setting "${key}" (add it to constants.ts or remove it)`);
      if (NUMERIC.test(key) && !Number.isFinite(Number(value))) problems.push(`${name}: ${key} must be a number, got "${value}"`);
    }
  }
  if (problems.length) {
    problems.forEach((p) => process.stderr.write(`✗ ${p}\n`));
    return 1;
  }
  process.stdout.write(`✓ config OK\n${JSON.stringify(groups, null, 2)}\n`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`✗ ${err instanceof SettingsError ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
