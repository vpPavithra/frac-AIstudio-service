// `npm run review:report -- <id>`: the review analysis report (tools/reports/review-report.ts) for one target,
// from Postgres (POSTGRES_* in .env), written to reports/reviews/review-<id>.md.
//   <id> = a Reviewer upload's review id  → that review (and how many times it was run)
//   <id> = a FRAC id                      → every expert check of that FRAC, latest first, with a history table
//   <id> = an expert check's review id    → that one check
// Each review is linked to the calls that produced it: an upload by its review jobs, an expert check by the
// FRAC's check job that finished closest to the review.
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPORTS } from "../../src/config/constants.ts";
import { createPool, poolTarget } from "../../src/config/db.ts";
import { checkDatabase } from "../../src/db/check.ts";
import type { Job } from "../../src/models/job.model.ts";
import type { ReviewRecord } from "../../src/models/review.model.ts";
import { pgRepositories } from "../../src/repositories/index.ts";
import { buildReviewReport, type ReviewAnalysisItem, type ReviewReportInput } from "./review-report.ts";

type Repos = ReturnType<typeof pgRepositories>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
/** The id: `--id <id>` or the first argument that is not a flag. */
const targetId = () => arg("id") ?? process.argv.slice(2).find((a) => !a.startsWith("--") && a !== arg("out"));

/** An upload with its review jobs (every run of it, "Run a fresh review" included) and their calls. */
async function uploadItem(repos: Repos, review: ReviewRecord): Promise<ReviewAnalysisItem> {
  const jobs = (await repos.jobs.listSince(new Date(review.createdAt))).filter((j) => j.kind === "review" && j.targetId === review.id);
  const ids = new Set(jobs.map((j) => j.id));
  const calls = (await repos.aiCalls.listSince(new Date(review.createdAt))).filter((c) => c.jobId !== null && ids.has(c.jobId));
  return { review, calls, runs: jobs.length };
}

/** An expert check with the FRAC's check job that finished closest to it, and that job's calls. */
async function checkItem(repos: Repos, review: ReviewRecord, checkJobs: Job[]): Promise<ReviewAnalysisItem> {
  const t = Date.parse(review.createdAt);
  const job = [...checkJobs].sort((a, b) => Math.abs(Date.parse(a.updatedAt) - t) - Math.abs(Date.parse(b.updatedAt) - t))[0];
  if (!job) return { review, calls: [], runs: 0 };
  const calls = (await repos.aiCalls.listSince(new Date(job.createdAt))).filter((c) => c.jobId === job.id);
  return { review, calls, runs: 1 };
}

/** Works out what the id names and loads everything the report needs. */
async function load(repos: Repos, id: string): Promise<Omit<ReviewReportInput, "generatedAt" | "utcOffsetMinutes">> {
  const review = await repos.reviews.get(id);
  if (review?.kind === "upload") {
    return { targetKind: "review", targetId: id, targetName: `Review ${review.sourceName || id.slice(0, 8)}`, items: [await uploadItem(repos, review)] };
  }
  const fracId = review?.fracId ?? id;
  const frac = await repos.fracs.get(fracId);
  if (!frac) throw new Error(`No review or FRAC with id ${id}.`);
  const name = `FRAC ${frac.cadre} · ${frac.state} · ${frac.size}`;
  const since = new Date(frac.createdAt);
  const checkJobs = (await repos.jobs.listSince(since)).filter((j) => j.kind === "check" && j.targetId === fracId);
  const checks = review ? [review] : (await repos.reviews.listSince(since)).filter((r) => r.kind === "expert-check" && r.fracId === fracId);
  if (!checks.length) throw new Error(`${name} has no expert check yet: run "Run expert check" in the Creator first.`);
  const items = await Promise.all(checks.map((r) => checkItem(repos, r, checkJobs)));
  return { targetKind: review ? "review" : "frac", targetId: id, targetName: review ? `Expert check of ${name}` : name, items };
}

async function main(): Promise<number> {
  const id = targetId();
  if (!id) {
    process.stderr.write("✗ Give a review id or a FRAC id: npm run review:report -- <id>\n");
    return 1;
  }
  if (!UUID.test(id)) {
    process.stderr.write(`✗ "${id}" is not a review or FRAC id (expected a UUID like e5dd92cd-e7a1-4016-a1b0-9bcbae4a9397)\n`);
    return 1;
  }
  const pool = createPool();
  try {
    await checkDatabase(pool, poolTarget());
    const input = await load(pgRepositories(pool), id);
    const out = path.resolve(arg("out") ?? path.join(REPORTS.dir, "reviews", `review-${id.slice(0, 8)}.md`));
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, buildReviewReport({ ...input, generatedAt: new Date(), utcOffsetMinutes: REPORTS.utcOffsetMinutes }));
    process.stdout.write(`✓ ${input.items.length} review(s) of ${input.targetName} → ${path.relative(process.cwd(), out)}\n`);
    return 0;
  } finally {
    await pool.end();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
