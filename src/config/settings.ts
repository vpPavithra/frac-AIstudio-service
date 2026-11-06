// Non-secret settings in a reviewed file, secrets in the environment (aastrika-ai-service pattern).
//
//   config/service.json   every tunable: models, rates, limits, timeouts. Committed and diffable.
//   .env / secret store   secrets and per-deployment values only (API key, Postgres credentials).
//
// Precedence, lowest to highest:  code default < service.json < service.<NODE_ENV>.json < process.env
// Values are merged into process.env, the one place constants.ts reads from.
// Called by constants.ts (loadSettings, at import) and scripts/check-config.ts (readSettingsFile).
import fs from "node:fs";
import path from "node:path";

/** Keys that must never appear in a committed config file. Checked at boot, not trusted. */
export const SECRET_KEYS = ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "POSTGRES_PASSWORD", "DATABASE_URL"] as const;

const SECRETS = new Set<string>(SECRET_KEYS);
/** Any provider's key (the `keyEnv` of a profile in ai-providers.json) is a secret too, whatever the provider. */
const isSecret = (key: string) => SECRETS.has(key) || key.endsWith("_API_KEY");
const SETTING_NAME = /^[A-Z][A-Z0-9_]*$/;

/** Thrown at boot: a malformed config file must not start half-applied. */
export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

/** Reads and checks one settings file. Comment keys start with "//". */
export function readSettingsFile(file: string): [string, string | number | boolean][] {
  if (!fs.existsSync(file)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new SettingsError(`${file} is not valid JSON: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SettingsError(`${file} must contain a JSON object of KEY: value pairs.`);
  }
  const entries = Object.entries(parsed as Record<string, unknown>).filter(([key]) => !key.startsWith("//"));

  const leaked = entries.filter(([key]) => isSecret(key)).map(([key]) => key);
  if (leaked.length) {
    throw new SettingsError(
      `${file} contains secrets: ${leaked.join(", ")}. This file is committed to git; move them to the environment. Nothing was applied.`,
    );
  }

  const out: [string, string | number | boolean][] = [];
  for (const [key, value] of entries) {
    if (!SETTING_NAME.test(key)) {
      throw new SettingsError(`${file} has an invalid setting name "${key}". Use UPPER_SNAKE_CASE.`);
    }
    if (value === null || value === undefined) continue; // use the code default
    if (typeof value === "object") {
      throw new SettingsError(`${file} setting "${key}" must be a string, number or boolean.`);
    }
    out.push([key, value as string | number | boolean]);
  }
  return out;
}

/**
 * Applies service.<NODE_ENV>.json then service.json to process.env, never overwriting a value
 * that is already set, so the environment always wins and the overlay beats the base file.
 */
export function loadSettings(configDir = path.resolve(process.cwd(), "config")): { applied: number; files: string[] } {
  const env = process.env.NODE_ENV;
  const candidates = [...(env ? [path.join(configDir, `service.${env}.json`)] : []), path.join(configDir, "service.json")];
  let applied = 0;
  const files: string[] = [];
  for (const file of candidates) {
    const entries = readSettingsFile(file);
    if (fs.existsSync(file)) files.push(path.basename(file));
    for (const [key, value] of entries) {
      if (process.env[key] !== undefined && process.env[key] !== "") continue;
      process.env[key] = String(value);
      applied++;
    }
  }
  return { applied, files };
}
