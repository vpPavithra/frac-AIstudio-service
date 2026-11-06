// The Postgres path end to end on pg-mem (an in-memory Postgres): the real migration through the
// real runner, then the spec 8 flows through the pg repositories. No database server needed.
import ExcelJS from "exceljs";
import { DataType, newDb } from "pg-mem";
import type { Pool } from "pg";
import request from "supertest";
import { ComputedOnlyReviewer } from "../src/services/ai-review.service.ts";
import { createApp } from "../src/app.ts";
import { loadReviewRules } from "../src/config/review-rules.ts";
import { loadMigrations, runMigrations } from "../src/db/migrate.ts";
import { JobRunner } from "../src/services/queue/job-runner.ts";
import { pgRepositories } from "../src/repositories/index.ts";
import { FracService } from "../src/services/frac.service.ts";
import { ReviewService } from "../src/services/review.service.ts";
import { stubProvider } from "./support/stub-provider.ts";
import { gnmSample } from "./support/sample-workbooks.ts";
import { goodLevels } from "./support/test-data.ts";

const OWNER = { "x-aastrika-creator": "user-1" };

async function setup() {
  // pg-mem flags a skipped CREATE TABLE IF NOT EXISTS as unsupported; real Postgres just skips it
  const db = newDb({ noAstCoverageCheck: true });
  // pg-mem has no advisory locks; a single in-process database cannot race anyway
  for (const name of ["pg_advisory_lock", "pg_advisory_unlock"]) {
    db.public.registerFunction({ name, args: [DataType.integer], returns: DataType.text, implementation: () => "" });
  }
  const { Pool: MemPool } = db.adapters.createPg();
  const pool = new MemPool() as unknown as Pool;
  const applied = await runMigrations(pool, loadMigrations());

  const repos = pgRepositories(pool);
  const runner = new JobRunner(repos.jobs);
  const reviews = new ReviewService(repos, runner, new ComputedOnlyReviewer(), () => loadReviewRules());
  const provider = stubProvider();
  const fracs = new FracService(repos, runner, reviews, () => "Method", provider);
  return { app: createApp({ fracs, reviews, jobs: repos.jobs, provider }), runner, pool, applied };
}

const roles = [
  {
    code: "R1",
    title: "Conduct VHSND sessions",
    source: "JD",
    activities: [{ code: "A1", text: "Conduct immunisation session", postings: { P1: "Yes" }, source: "JD", tier: "JD", comp: "C1@L3" }],
  },
];
const competencies = [
  { code: "C1", label: "Immunisation", description: "Conducts sessions", type: "Domain", area: "PH", kcm: "", levels: goodLevels("C1") },
];

describe("Postgres path (pg-mem)", () => {
  it("applies every migration once and is a no-op the second time", async () => {
    const { pool, applied } = await setup();
    expect(applied).toEqual(["001_init.sql", "002_job_error_code.sql", "003_review_fingerprint.sql", "004_ai_calls.sql", "005_ai_call_started_at.sql", "006_ai_call_thinking_tokens.sql", "007_server_runs.sql", "008_review_answer_cache.sql"]);
    expect(await runMigrations(pool, loadMigrations())).toEqual([]);
  });

  it("reviews an upload and reopens it in the Creator through the pg repositories", async () => {
    const { app, runner } = await setup();
    const wb = new ExcelJS.Workbook();
    for (const s of gnmSample()) wb.addWorksheet(s.name).addRows(s.rows);
    const file = Buffer.from(await wb.xlsx.writeBuffer());

    const res = await request(app).post("/v1/frac-reviews").set(OWNER).attach("file", file, "GNM.xlsx").expect(202);
    await runner.idle();
    const review = await request(app).get(`/v1/frac-reviews/${res.body.reviewId}`).set(OWNER).expect(200);
    expect(review.body.report.findings.some((f: { sev: string }) => f.sev === "B")).toBe(true);
    expect(review.body.sourceModel.competencies.length).toBeGreaterThan(0);

    const open = await request(app).post(`/v1/frac-reviews/${res.body.reviewId}/open-in-creator`).set(OWNER).expect(200);
    const again = await request(app).post(`/v1/frac-reviews/${res.body.reviewId}/open-in-creator`).set(OWNER).expect(200);
    expect(again.body.fracId).toBe(open.body.fracId);
  });

  it("stores, edits, checks, snapshots and restores a FRAC through the pg repositories", async () => {
    const { app, runner } = await setup();
    const created = await request(app).post("/v1/fracs").set(OWNER).send({ cadre: "ANM", state: "Bihar" }).expect(201);
    const id = created.body.id as string;
    await request(app)
      .patch(`/v1/fracs/${id}`)
      .set(OWNER)
      .send({ postings: [{ key: "P1", label: "ANM at Sub-Centre" }], roles, competencies })
      .expect(200);

    const list = await request(app).get("/v1/fracs").set(OWNER).expect(200);
    expect(list.body.fracs).toEqual([expect.objectContaining({ id, counts: { roles: 1, activities: 1, competencies: 1 } })]);

    const started = await request(app).post(`/v1/fracs/${id}/steps/check`).set(OWNER).expect(202);
    await runner.idle();
    const job = await request(app).get(`/v1/jobs/${started.body.jobId}`).set(OWNER).expect(200);
    expect(job.body.status).toBe("done");

    const checked = await request(app).get(`/v1/fracs/${id}`).set(OWNER);
    expect(checked.body.frac.step).toBe(6);
    expect(checked.body.frac.review.checks).toHaveLength(5);

    const reviews = await request(app).get("/v1/frac-reviews").set(OWNER);
    expect(reviews.body.reviews).toEqual([expect.objectContaining({ kind: "expert-check", fracId: id })]);

    const versions = await request(app).get(`/v1/fracs/${id}/versions`).set(OWNER).expect(200);
    expect(versions.body.versions[0]).toMatchObject({ reason: "Expert check", step: 6 });

    await request(app).patch(`/v1/fracs/${id}`).set(OWNER).send({ competencies: [] }).expect(200);
    const restored = await request(app)
      .post(`/v1/fracs/${id}/versions/${versions.body.versions[0].id}/restore`)
      .set(OWNER)
      .expect(200);
    expect(restored.body.frac.competencies).toHaveLength(1);
  });
});
