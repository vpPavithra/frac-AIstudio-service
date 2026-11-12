// Loader for config/ai-providers.json: the named AI provider profiles AI_PROVIDER chooses between
// (model per tier, thinking level, list prices, key variable, web search, free tier, concurrency cap).
// Called once at startup by providers/registry.ts, and by the mock to price its estimate.
// The path comes from PATHS.aiProviders (AI_PROVIDERS_CONFIG_PATH). Keys starting "//" are comments.
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PATHS } from "./constants.ts";
import { SettingsError } from "./settings.ts";

/** Implementations that exist in src/providers/text. A profile's `kind` must be one of these. */
export const PROVIDER_KINDS = ["claude"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

const usd = z.number().min(0);
const tierRates = z.object({ inUsdPer1M: usd, outUsdPer1M: usd, cacheReadUsdPer1M: usd });
const level = z.enum(["low", "medium", "high"]);

const profileSchema = z.object({
  kind: z.enum(PROVIDER_KINDS),
  /** The environment variable holding this provider's key, e.g. ANTHROPIC_API_KEY. */
  keyEnv: z
    .string()
    .regex(
      /^[A-Z][A-Z0-9_]*_API_KEY$/,
      "must be the NAME of the environment variable that holds the key (e.g. ANTHROPIC_API_KEY), not the key itself. Put the key in .env",
    ),
  freeTier: z.boolean().default(false),
  maxConcurrent: z.number().int().min(1).optional(),
  models: z.object({ complex: z.string().min(1), default: z.string().min(1) }),
  thinking: z.object({ complex: level, default: level }),
  webSearch: z.boolean().default(false),
  /** Claude only: ask the API to re-run a declined request on its fallback model. Off for models without one (Haiku 5.5). */
  serverFallback: z.object({ complex: z.boolean(), default: z.boolean() }).default({ complex: true, default: true }),
  rates: z.object({ complex: tierRates, default: tierRates, cacheWriteMultiplier: usd.default(1), webSearchUsdPer1K: usd.default(0) }),
});

/** One provider profile, validated. */
export type AiProfile = z.infer<typeof profileSchema> & { name: string };
/** Per-tier prices plus the shared multipliers; what pricing.ts needs. */
export type ProviderRates = AiProfile["rates"];
/** low | medium | high, mapped by each provider to its own API setting. */
export type ThinkingLevel = z.infer<typeof level>;

/**
 * Reads every profile at startup. A malformed profile stops startup with its name and the field at
 * fault, rather than failing on the first model call. Throws SettingsError (a JSON syntax error throws SyntaxError).
 */
export function loadAiProfiles(file = path.resolve(process.cwd(), PATHS.aiProviders)): Record<string, AiProfile> {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const out: Record<string, AiProfile> = {};
  for (const [name, raw] of Object.entries(parsed)) {
    if (name.startsWith("//")) continue;
    if (name === "mock") throw new SettingsError(`${file}: "mock" is reserved for the sample-data provider; rename that profile.`);
    const result = profileSchema.safeParse(raw);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new SettingsError(`${file}: profile "${name}" ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    out[name] = { ...result.data, name };
  }
  return out;
}
