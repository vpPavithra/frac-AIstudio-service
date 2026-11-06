// AI PROVIDER REGISTRY: picks the one TextProvider every AI call uses (Creator steps and the Reviewer).
// Called once by src/server.ts at startup (and by scripts/ai-check.ts). AI_PROVIDER names a profile in
// config/ai-providers.json, or "mock". The profile's `kind` picks the implementation from FACTORIES and its
// `keyEnv` names the environment variable holding the key.
// To add a provider: write src/providers/text/<kind>.ts implementing TextProvider, add it to FACTORIES and
// PROVIDER_KINDS (config/ai-providers.ts), and add a profile. Nothing else changes.
// The mock in src/mocks is loaded dynamically so the folder can be deleted without a code change.
import { type AiProfile, loadAiProfiles, type ProviderKind } from "../config/ai-providers.ts";
import { AI } from "../config/constants.ts";
import type { FracService } from "../services/frac.service.ts";
import type { JobRunner } from "../services/queue/job-runner.ts";
import type { ReviewService } from "../services/review.service.ts";
import { ClaudeTextProvider } from "./text/claude.ts";
import { GeminiTextProvider } from "./text/gemini.ts";
import { limitConcurrency } from "./text/limit.ts";
import type { TextProvider } from "./text/types.ts";

/** One constructor per provider kind. */
const FACTORIES: Record<ProviderKind, (profile: AiProfile, apiKey: string) => TextProvider> = {
  claude: (profile, key) => new ClaudeTextProvider(profile, key),
  gemini: (profile, key) => new GeminiTextProvider(profile, key),
};

/** The value of AI_PROVIDER that selects the sample-data mock. */
export const MOCK_PROVIDER = "mock";

/** What src/mocks/index.ts exports. Declared here so nothing imports the mocks folder statically. */
export interface MocksModule {
  createMockProvider(): TextProvider;
  seedMockData(deps: { fracs: FracService; reviews: ReviewService; runner: JobRunner }, owners: string[]): Promise<number>;
}

/** What createAi returns to server.ts. */
export interface AiSetup {
  provider: TextProvider;
  /** Present only when the mock answers, for the optional sample-data seed. */
  mocks: MocksModule | null;
  /** The profile in use; null for the mock. */
  profile: AiProfile | null;
}

/**
 * Loads src/mocks if it exists. The specifier is built at runtime (.ts under ts-node, .js in dist),
 * so the build does not depend on the folder: deleting it leaves this returning null.
 */
async function loadMocks(): Promise<MocksModule | null> {
  const ext = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const url = new URL(`../mocks/index.${ext}`, import.meta.url);
  try {
    return (await import(url.href)) as MocksModule;
  } catch (err) {
    // Only "this exact file is missing" means no mocks; any other error (e.g. a broken import inside it) is real
    const missing = (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" && String((err as Error).message).includes(url.pathname);
    if (missing) return null;
    throw err;
  }
}

/**
 * Builds the provider AI_PROVIDER names. "mock" loads src/mocks; anything else must be a profile in
 * config/ai-providers.json whose key is set in the environment. Startup stops with a message saying
 * what to set otherwise. The key comes from the environment only: the service's .env locally, the
 * deployment's secret store on a server; config files are committed and startup refuses keys in them.
 */
export async function createAi(
  name: string = AI.provider,
  profiles: Record<string, AiProfile> = loadAiProfiles(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<AiSetup> {
  if (name === MOCK_PROVIDER) {
    const mocks = await loadMocks();
    if (!mocks) {
      throw new Error("AI_PROVIDER=mock but src/mocks is missing. Restore it, or set AI_PROVIDER to a profile in config/ai-providers.json.");
    }
    return { provider: mocks.createMockProvider(), mocks, profile: null };
  }
  const profile = profiles[name];
  if (!profile) {
    const known = [MOCK_PROVIDER, ...Object.keys(profiles)].join(", ");
    throw new Error(`AI_PROVIDER="${name}" is not a profile in config/ai-providers.json. Use one of: ${known}.`);
  }
  const apiKey = env[profile.keyEnv]?.trim() ?? "";
  if (!apiKey) {
    throw new Error(
      `AI_PROVIDER=${name} needs ${profile.keyEnv} in the environment (.env locally, the secret store on a server). ` +
        "To run without a key, use `npm run dev:mock`.",
    );
  }
  const provider = FACTORIES[profile.kind](profile, apiKey);
  return { provider: profile.maxConcurrent ? limitConcurrency(provider, profile.maxConcurrent) : provider, mocks: null, profile };
}
