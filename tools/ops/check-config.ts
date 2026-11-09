// `npm run config:check`: fails CI when config/service.json would break or silently mislead.
// Checks: valid JSON, no secrets, UPPER_SNAKE names (readSettingsFile), every key known to
// constants.ts (a typo would otherwise be ignored and the code default used), and numbers that
// parse. Also loads config/ai-providers.json and checks that AI_PROVIDER and MOCK_PRICED_AS name a profile.
// Prints the resolved non-secret settings. Reads config/service.json and service.<NODE_ENV>.json; it does
// not check config/frac-sizes.json, review-rules.json or outdated.json (those are checked when loaded).
import path from "node:path";
import { readSettingsFile, SettingsError } from "../../src/config/settings.ts";

/** Setting names whose value must parse as a number, recognised by suffix/prefix (e.g. LLM_TIMEOUT_MS, MAX_ROLES). */
const NUMERIC = /(_MS|_MB|_CHARS|_RETRIES|_USD_PER_1M|_USD_PER_1K|_MULTIPLIER|_TOKENS|_RESUMES|_USES|_SIZE|_PARALLEL|_ITEMS|_WORDS|_MINUTES|_USD|^MAX_|^PORT$|_TEMPERATURE$)/;

/** Runs every check and returns the exit code (0 OK, 1 problems), so all problems print in one run. */
async function main(): Promise<number> {
  const configDir = path.resolve(process.cwd(), "config");
  const files = ["service.json", ...(process.env.NODE_ENV ? [`service.${process.env.NODE_ENV}.json`] : [])];
  // Imported lazily: loading constants.ts applies service.json, which would throw before we could report on it
  const { KNOWN_SETTINGS, ...groups } = await import("../../src/config/constants.ts");
  const { loadAiProfiles } = await import("../../src/config/ai-providers.ts");
  const profiles = loadAiProfiles();
  const known = new Set<string>(KNOWN_SETTINGS);
  const problems: string[] = [];

  for (const name of files) {
    for (const [key, value] of readSettingsFile(path.join(configDir, name))) {
      if (!known.has(key)) problems.push(`${name}: unknown setting "${key}" (add it to constants.ts or remove it)`);
      if (NUMERIC.test(key) && !Number.isFinite(Number(value))) problems.push(`${name}: ${key} must be a number, got "${value}"`);
    }
  }
  if (groups.AI.provider !== "mock" && !profiles[groups.AI.provider]) {
    problems.push(`AI_PROVIDER "${groups.AI.provider}" is not "mock" or a profile in ai-providers.json (${Object.keys(profiles).join(", ")})`);
  }
  if (!profiles[groups.MOCK.pricedAs]) problems.push(`MOCK_PRICED_AS "${groups.MOCK.pricedAs}" is not a profile in ai-providers.json`);
  if (problems.length) {
    problems.forEach((p) => process.stderr.write(`✗ ${p}\n`));
    return 1;
  }
  process.stdout.write(`✓ config OK\n${JSON.stringify({ ...groups, providerProfiles: Object.keys(profiles) }, null, 2)}\n`);
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
