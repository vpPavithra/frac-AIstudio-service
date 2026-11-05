import "dotenv/config";
import { ChecklistReviewer } from "./services/ai-review.service.ts";
import { createApp } from "./app.ts";
import { JOBS, MOCK, SERVER } from "./config/constants.ts";
import { createPool, poolTarget } from "./config/db.ts";
import { checkDatabase } from "./db/check.ts";
import { loadMethodParagraph } from "./config/method.ts";
import { loadReviewRules } from "./config/review-rules.ts";
import { loadMigrations, runMigrations } from "./db/migrate.ts";
import { JobRunner } from "./services/queue/job-runner.ts";
import { startJobWatchdog } from "./services/job-watchdog.service.ts";
import { createAi } from "./providers/registry.ts";
import { memoryRepositories, pgRepositories } from "./repositories/index.ts";
import { FracService } from "./services/frac.service.ts";
import { ReviewService } from "./services/review.service.ts";
import { describeError, logger } from "./utils/logger.ts";

const inMemory = SERVER.store === "memory";

const pool = inMemory ? null : createPool();
const repos = pool ? pgRepositories(pool) : memoryRepositories();
const runner = new JobRunner(repos.jobs);

async function start(): Promise<void> {
  // Claude when ANTHROPIC_API_KEY is set, otherwise the sample-data mock (src/mocks); AI_PROVIDER forces one
  const { provider, mocks } = await createAi();
  // The rule tables are re-read per review so reviewers' edits apply without a restart
  const reviews = new ReviewService(repos, runner, new ChecklistReviewer(provider), () => loadReviewRules());
  const fracs = new FracService(repos, runner, reviews, () => loadMethodParagraph(), provider);
  if (pool) await checkDatabase(pool, poolTarget());
  if (pool && SERVER.migrateOnStart) {
    const applied = await runMigrations(pool, loadMigrations());
    logger.info(applied.length ? "Applied migrations" : "Database is up to date", { applied });
  }
  const stopWatchdog = startJobWatchdog(repos.jobs, JOBS);
  const server = createApp({ fracs, reviews, jobs: repos.jobs, provider }).listen(SERVER.port, () => {
    logger.info("frac-studio-service listening", { port: SERVER.port, store: inMemory ? "memory" : "postgres", ai: provider.name });
  });
  if (MOCK.seed && mocks) {
    if (!inMemory) logger.warn("MOCK_SEED is ignored outside the memory store");
    else
      mocks.seedMockData({ fracs, reviews, runner }, MOCK.seedOwners)
        .then((n) => logger.info("Mock data seeded", { owners: MOCK.seedOwners, fracs: n }))
        .catch((err: unknown) => logger.error("Mock seed failed", { error: describeError(err) }));
  }

  // On a rolling deploy, stop taking requests and let running jobs finish before exiting
  process.once("SIGTERM", () => {
    stopWatchdog();
    server.close(async () => {
      await runner.idle();
      await pool?.end();
      process.exit(0);
    });
  });
}

start().catch(async (err: unknown) => {
  logger.error("Startup failed", { error: describeError(err) });
  await pool?.end().catch(() => undefined);
  process.exit(1);
});
