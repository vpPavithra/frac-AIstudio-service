import "dotenv/config";
import { ComputedOnlyReviewer } from "./agents/agent-reviewer.js";
import { createApp } from "./app.js";
import { JOBS, SERVER } from "./config/constants.js";
import { createPool } from "./config/db.js";
import { loadMethodParagraph } from "./config/method.js";
import { loadOutdatedPatterns } from "./config/outdated.js";
import { loadMigrations, runMigrations } from "./db/migrate.js";
import { JobRunner } from "./jobs/job-runner.js";
import { startJobWatchdog } from "./jobs/job-watchdog.js";
import { memoryRepositories } from "./repositories/memory.js";
import { pgRepositories } from "./repositories/pg.js";
import { FracService } from "./services/frac.service.js";
import { ReviewService } from "./services/review.service.js";
import { logger } from "./utils/logger.js";

const inMemory = SERVER.store === "memory";

const pool = inMemory ? null : createPool();
const repos = pool ? pgRepositories(pool) : memoryRepositories();
const runner = new JobRunner(repos.jobs);
// The OUTDATED list is re-read per review so reviewers' edits apply without a restart
const reviews = new ReviewService(repos, runner, new ComputedOnlyReviewer(), () => loadOutdatedPatterns());
const fracs = new FracService(repos, runner, reviews, () => loadMethodParagraph());

async function start(): Promise<void> {
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

start().catch((err: unknown) => {
  logger.error("Startup failed", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
