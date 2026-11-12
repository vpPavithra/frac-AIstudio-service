// Process entry point (`npm run dev`, `npm start` → dist/server.js). Picks the store (Postgres or
// memory, FRAC_STUDIO_STORE), the AI provider (a profile in config/ai-providers.json, or mock), wires repositories → JobRunner →
// services → app, optionally runs migrations (MIGRATE_ON_START), starts the stuck-job watchdog and
// listens on PORT. Reads .env (dotenv), config/service.json via constants.ts, and the rule/method files.
import "dotenv/config";
import { hostname } from "node:os";
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
import { DocumentService } from "./services/document.service.ts";
import { FracService } from "./services/frac.service.ts";
import { ReviewService } from "./services/review.service.ts";
import { describeError, logger } from "./utils/logger.ts";

// "memory" keeps everything in process (lost on restart); any other value means Postgres via POSTGRES_* env vars
const inMemory = SERVER.store === "memory";

const pool = inMemory ? null : createPool();
const repos = pool ? pgRepositories(pool) : memoryRepositories();
// Each model call is also logged to ai_calls for the AI response report (npm run ai:report)
const runner = new JobRunner(repos.jobs, JOBS.heartbeatMs, repos.aiCalls);

async function start(): Promise<void> {
  // AI_PROVIDER: a profile in config/ai-providers.json (needs its key) or mock (`npm run dev:mock`)
  const { provider, mocks } = await createAi();
  // The rule tables are re-read per review so reviewers' edits apply without a restart
  const reviews = new ReviewService(repos, runner, new ChecklistReviewer(provider, repos.reviewAnswers), () => loadReviewRules());
  // The method paragraph (config/method.txt) is also re-read per export, for the same reason
  const fracs = new FracService(repos, runner, reviews, () => loadMethodParagraph(), provider);
  const documents = new DocumentService(repos, fracs);
  // Refuse to start when Postgres is unreachable, rather than failing every request later
  if (pool) await checkDatabase(pool, poolTarget());
  if (pool && SERVER.migrateOnStart) {
    const applied = await runMigrations(pool, loadMigrations());
    logger.info(applied.length ? "Applied migrations" : "Database is up to date", { applied });
  }
  // Jobs run in this process; the watchdog fails any job left queued/running by a crash or restart
  const stopWatchdog = startJobWatchdog(repos.jobs, JOBS);
  // A server_runs row marks this run's start (and, below, its stop) for npm run ai:report:run.
  // Reporting only: if it cannot be written (e.g. migration 007 not applied yet), the service still starts.
  const runId = await repos.serverRuns
    .start({ provider: provider.name, store: inMemory ? "memory" : "postgres", host: hostname(), pid: process.pid })
    .catch((err: unknown) => {
      logger.warn("Server run not recorded", { error: describeError(err) });
      return null;
    });
  const server = createApp({ fracs, documents, reviews, jobs: repos.jobs, provider }).listen(SERVER.port, () => {
    logger.info("frac-studio-service listening", { port: SERVER.port, store: inMemory ? "memory" : "postgres", ai: provider.name, run: runId });
  });
  // MOCK_SEED: fill the memory store with sample FRACs/reviews for local UI work (mock provider only)
  if (MOCK.seed && mocks) {
    if (!inMemory) logger.warn("MOCK_SEED is ignored outside the memory store");
    else
      mocks.seedMockData({ fracs, reviews, runner }, MOCK.seedOwners)
        .then((n) => logger.info("Mock data seeded", { owners: MOCK.seedOwners, fracs: n }))
        .catch((err: unknown) => logger.error("Mock seed failed", { error: describeError(err) }));
  }

  // On a rolling deploy (SIGTERM) or Ctrl+C (SIGINT): stop taking requests, let running jobs finish,
  // close this run's server_runs row, then exit. A second Ctrl+C exits at once.
  const shutdown = (signal: string) => {
    logger.info("Shutting down", { signal, run: runId });
    stopWatchdog();
    server.close(async () => {
      await runner.idle();
      if (runId !== null) await repos.serverRuns.stop(runId).catch(() => undefined);
      await pool?.end();
      process.exit(0);
    });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

start().catch(async (err: unknown) => {
  logger.error("Startup failed", { error: describeError(err) });
  await pool?.end().catch(() => undefined);
  process.exit(1);
});
