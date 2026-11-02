import "dotenv/config";
import { ComputedOnlyReviewer } from "./agents/agent-reviewer.js";
import { createApp } from "./app.js";
import { createPool } from "./config/db.js";
import { loadMethodParagraph } from "./config/method.js";
import { loadOutdatedPatterns } from "./config/outdated.js";
import { loadMigrations, runMigrations } from "./db/migrate.js";
import { JobRunner } from "./jobs/job-runner.js";
import { memoryRepositories } from "./repositories/memory.js";
import { pgRepositories } from "./repositories/pg.js";
import { FracService } from "./services/frac.service.js";
import { ReviewService } from "./services/review.service.js";

const port = Number(process.env.PORT ?? 3005);
const inMemory = process.env.FRAC_STUDIO_STORE === "memory";

const pool = inMemory ? null : createPool();
const repos = pool ? pgRepositories(pool) : memoryRepositories();
const runner = new JobRunner(repos.jobs);
// The OUTDATED list is re-read per review so reviewers' edits apply without a restart
const reviews = new ReviewService(repos, runner, new ComputedOnlyReviewer(), () => loadOutdatedPatterns());
const fracs = new FracService(repos, runner, reviews, () => loadMethodParagraph());

async function start(): Promise<void> {
  if (pool && process.env.MIGRATE_ON_START === "true") {
    const applied = await runMigrations(pool, loadMigrations());
    console.log(applied.length ? `Applied migrations: ${applied.join(", ")}` : "Database is up to date");
  }
  const server = createApp({ fracs, reviews, jobs: repos.jobs }).listen(port, () => {
    console.log(`frac-studio-service listening on ${port}${inMemory ? " (in-memory store)" : ""}`);
  });

  // On a rolling deploy, stop taking requests and let running jobs finish before exiting
  process.once("SIGTERM", () => {
    server.close(async () => {
      await runner.idle();
      await pool?.end();
      process.exit(0);
    });
  });
}

start().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
