import "dotenv/config";
import { ComputedOnlyReviewer } from "./agents/agent-reviewer.js";
import { createApp } from "./app.js";
import { createPool } from "./config/db.js";
import { loadMethodParagraph } from "./config/method.js";
import { loadOutdatedPatterns } from "./config/outdated.js";
import { JobRunner } from "./jobs/job-runner.js";
import { memoryRepositories } from "./repositories/memory.js";
import { pgRepositories } from "./repositories/pg.js";
import { FracService } from "./services/frac.service.js";
import { ReviewService } from "./services/review.service.js";

const port = Number(process.env.PORT ?? 3005);
const inMemory = process.env.FRAC_STUDIO_STORE === "memory";

const repos = inMemory ? memoryRepositories() : pgRepositories(createPool());
const runner = new JobRunner(repos.jobs);
// The OUTDATED list is re-read per review so reviewers' edits apply without a restart
const reviews = new ReviewService(repos, runner, new ComputedOnlyReviewer(), () => loadOutdatedPatterns());
const fracs = new FracService(repos, runner, reviews, () => loadMethodParagraph());

createApp({ fracs, reviews, jobs: repos.jobs }).listen(port, () => {
  console.log(`frac-studio-service listening on ${port}${inMemory ? " (in-memory store)" : ""}`);
});
