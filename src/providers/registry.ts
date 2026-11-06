// AI PROVIDER REGISTRY: picks the one TextProvider every AI call uses (Creator steps and the Reviewer).
// Called once by src/server.ts at startup. Reads AI.provider (AI_PROVIDER) and AI.apiKey (ANTHROPIC_API_KEY).
// The mock in src/mocks is loaded dynamically so the folder can be deleted without a code change.
import { AI } from "../config/constants.ts";
import type { FracService } from "../services/frac.service.ts";
import type { JobRunner } from "../services/queue/job-runner.ts";
import type { ReviewService } from "../services/review.service.ts";
import { ClaudeTextProvider } from "./text/claude.ts";
import type { TextProvider } from "./text/types.ts";

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
 * Picks the AI provider (AI_PROVIDER, default "auto"):
 * - auto: Claude when ANTHROPIC_API_KEY is set, otherwise the mock (if src/mocks exists).
 * - claude / mock: force one; startup fails with a clear message if it cannot be used.
 * The key comes from the environment only: the service's .env locally, the deployment's secret store
 * on a server. config/service.json is committed and startup refuses secrets in it.
 */
export async function createAi(): Promise<AiSetup> {
  const wantClaude = AI.provider === "claude" || (AI.provider === "auto" && AI.apiKey !== "");
  if (wantClaude) {
    if (!AI.apiKey) {
      throw new Error("AI_PROVIDER=claude needs ANTHROPIC_API_KEY in the environment (.env locally, the secret store on a server).");
    }
    return { provider: new ClaudeTextProvider(AI.apiKey), mocks: null };
  }
  const mocks = await loadMocks();
  if (!mocks) {
    throw new Error("No AI provider: set ANTHROPIC_API_KEY in the environment, or restore src/mocks for sample data.");
  }
  return { provider: mocks.createMockProvider(), mocks };
}
