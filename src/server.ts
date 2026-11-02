import "dotenv/config";
import { ComputedOnlyReviewer } from "./services/ai-review.service.ts";
import { createApp } from "./app.ts";
import { JOBS, SERVER } from "./config/constants.ts";
import { createPool, poolTarget } from "./config/db.ts";
import { checkDatabase } from "./db/check.ts";
import { loadMethodParagraph } from "./config/method.ts";
import { loadOutdatedPatterns } from "./config/outdated.ts";
import { loadMigrations, runMigrations } from "./db/migrate.ts";
import { JobRunner } from "./services/queue/job-runner.ts";
import { startJobWatchdog } from "./services/job-watchdog.service.ts";
import { memoryRepositories, pgRepositories } from "./repositories/index.ts";
import { FracService } from "./services/frac.service.ts";
import { ReviewService } from "./services/review.service.ts";
import { describeError, logger } from "./utils/logger.ts";

const inMemory = SERVER.store === "memory";

const pool = inMemory ? null : createPool();
const repos = pool ? pgRepositories(pool) : memoryRepositories();
const runner = new JobRunner(repos.jobs);
// The OUTDATED list is re-read per review so reviewers' edits apply without a restart
const reviews = new ReviewService(repos, runner, new ComputedOnlyReviewer(), () => loadOutdatedPatterns());
const fracs = new FracService(repos, runner, reviews, () => loadMethodParagraph());

async function start(): Promise<void> {
  if (pool) await checkDatabase(pool, poolTarget());
  if (pool && SERVER.migrateOnStart) {
    const applied = await runMigrations(pool, loadMigrations());
    logger.info(applied.length ? "Applied migrations" : "Database is up to date", { applied });
  }
  const stopWatchdog = startJobWatchdog(repos.jobs, JOBS);
  const server = createApp({ fracs, reviews, jobs: repos.jobs }).listen(SERVER.port, () => {
    logger.info("frac-studio-service listening", { port: SERVER.port, store: inMemory ? "memory" : "postgres" });
  });

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
