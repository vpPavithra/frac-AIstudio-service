// `npm run config:check`: fails CI when config/service.json would break or silently mislead.
// Checks: valid JSON, no secrets, UPPER_SNAKE names (readSettingsFile), every key known to
// constants.ts (a typo would otherwise be ignored and the code default used), and numbers that
// parse. Prints the resolved non-secret settings.
import path from "node:path";
import { readSettingsFile, SettingsError } from "../config/settings.ts";

const NUMERIC = /(_MS|_MB|_CHARS|_RETRIES|_USD_PER_1M|^MAX_|^PORT$|_TEMPERATURE$)/;

async function main(): Promise<number> {
  const configDir = path.resolve(process.cwd(), "config");
  const files = ["service.json", ...(process.env.NODE_ENV ? [`service.${process.env.NODE_ENV}.json`] : [])];
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
