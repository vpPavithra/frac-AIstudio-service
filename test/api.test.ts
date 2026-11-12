// Spec 8 API end to end over HTTP, on the in-memory store and the computed-only reviewer.
import ExcelJS from "exceljs";
import request from "supertest";
import { ComputedOnlyReviewer } from "../src/services/ai-review.service.ts";
import { createApp } from "../src/app.ts";
import { loadReviewRules } from "../src/config/review-rules.ts";
import type { SheetData } from "../src/services/review-engine/parse-workbook.ts";
import { NO_COMPETENCY_SHEET } from "../src/services/review-engine/parse-workbook.ts";
import { JobRunner } from "../src/services/queue/job-runner.ts";
import { memoryRepositories } from "../src/repositories/index.ts";
import { DocumentService } from "../src/services/document.service.ts";
import { FracService } from "../src/services/frac.service.ts";
import { ReviewService } from "../src/services/review.service.ts";
import { stubProvider } from "./support/stub-provider.ts";
import { gnmSample } from "./support/sample-workbooks.ts";
import { goodLevels } from "./support/test-data.ts";

const OWNER = { "x-aastrika-creator": "user-1" };
const OTHER = { "x-aastrika-creator": "user-2" };

function setup() {
  const repos = memoryRepositories();
  const runner = new JobRunner(repos.jobs);
  const reviews = new ReviewService(repos, runner, new ComputedOnlyReviewer(), () => loadReviewRules());
  const provider = stubProvider();
  const fracs = new FracService(repos, runner, reviews, () => "Method text", provider);
  return { app: createApp({ fracs, documents: new DocumentService(repos, fracs), reviews, jobs: repos.jobs, provider }), runner, repos };
}

async function xlsx(sheets: SheetData[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) wb.addWorksheet(s.name).addRows(s.rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const roles = [
  {
    code: "R1",
    title: "Conduct VHSND sessions",
    source: "JD",
    activities: [
      { code: "A1", text: "Conduct immunisation session", postings: { P1: "Yes" }, source: "JD", tier: "JD", comp: "C1@L3" },
      { code: "A2", text: "Screen pregnant women", postings: { P1: "Yes" }, source: "JD", tier: "JD", comp: "C1@L3" },
    ],
  },
];
const competencies = [
  { code: "C1", label: "Immunisation", description: "Conducts sessions", type: "Domain", area: "PH", kcm: "", levels: goodLevels("C1") },
];

describe("identity", () => {
  it("rejects requests without the proxy user header", async () => {
    const { app } = setup();
    await request(app).get("/v1/fracs").expect(401);
  });

  it("serves /health without identity", async () => {
    const { app } = setup();
    await request(app).get("/health").expect(200);
  });
});

describe("reviewer", () => {
  it("reviews an upload as a job and stores the report and source model", async () => {
    const { app, runner } = setup();
    const res = await request(app)
      .post("/v1/frac-reviews")
      .set(OWNER)
      .field("cadre", "GNM")
      .attach("file", await xlsx(gnmSample()), "GNM sample.xlsx")
      .expect(202);
    await runner.idle();

    const job = await request(app).get(`/v1/jobs/${res.body.jobId}`).set(OWNER).expect(200);
    expect(job.body).toMatchObject({ status: "done", kind: "review", targetId: res.body.reviewId });

    const review = await request(app).get(`/v1/frac-reviews/${res.body.reviewId}`).set(OWNER).expect(200);
    expect(review.body.report.title).toBe("GNM sample");
    expect(review.body.report.cadre).toBe("GNM");
    expect(review.body.report.findings.some((f: { sev: string }) => f.sev === "B")).toBe(true);
    expect(review.body.sourceModel.competencies.length).toBeGreaterThan(0);

    const list = await request(app).get("/v1/frac-reviews").set(OWNER).expect(200);
    expect(list.body.reviews).toEqual([expect.objectContaining({ id: res.body.reviewId, worst: "B", kind: "upload" })]);
  });

  it("hides another user's review and job", async () => {
    const { app, runner } = setup();
    const res = await request(app)
      .post("/v1/frac-reviews")
      .set(OWNER)
      .attach("file", await xlsx(gnmSample()), "g.xlsx");
    await runner.idle();
    await request(app).get(`/v1/frac-reviews/${res.body.reviewId}`).set(OTHER).expect(404);
    await request(app).get(`/v1/jobs/${res.body.jobId}`).set(OTHER).expect(404);
  });

  it("rejects missing, non-xlsx, unreadable and sheet-less uploads with a coded 400", async () => {
    const { app } = setup();
    const code = (res: request.Response) => res.body.error.code;
    expect(code(await request(app).post("/v1/frac-reviews").set(OWNER).expect(400))).toBe("FILE_REQUIRED");
    const csv = await request(app).post("/v1/frac-reviews").set(OWNER).attach("file", Buffer.from("x"), "f.csv").expect(400);
    expect(code(csv)).toBe("FILE_TYPE_NOT_ALLOWED");
    const zip = await request(app).post("/v1/frac-reviews").set(OWNER).attach("file", Buffer.from("not a zip"), "f.xlsx").expect(400);
    expect(code(zip)).toBe("FILE_UNREADABLE");
    const noComp = await request(app)
      .post("/v1/frac-reviews")
      .set(OWNER)
      .attach("file", await xlsx([{ name: "Sheet1", rows: [["Role", "Activity"]] }]), "f.xlsx")
      .expect(400);
    expect(noComp.body.error).toEqual({ code: "NO_COMPETENCY_SHEET", message: NO_COMPETENCY_SHEET });
  });

  it("validates the context fields and answers unknown identity with a coded 401", async () => {
    const { app } = setup();
    const res = await request(app)
      .post("/v1/frac-reviews")
      .set(OWNER)
      .field("notes", "x".repeat(6000))
      .attach("file", await xlsx(gnmSample()), "g.xlsx")
      .expect(400);
    expect(res.body.error).toMatchObject({ code: "VALIDATION_FAILED", message: expect.stringContaining("notes") });
    const anon = await request(app).get("/v1/frac-reviews").expect(401);
    expect(anon.body.error.code).toBe("NOT_SIGNED_IN");
    expect(anon.headers["x-request-id"]).toBeTruthy();
  });

  it("exports the report and opens the reviewed file in the Creator once", async () => {
    const { app, runner } = setup();
    const res = await request(app).post("/v1/frac-reviews").set(OWNER).attach("file", await xlsx(gnmSample()), "GNM.xlsx");
    await runner.idle();

    const file = await request(app).get(`/v1/frac-reviews/${res.body.reviewId}/export.xlsx`).set(OWNER).expect(200);
    expect(file.headers["content-disposition"]).toContain(encodeURIComponent("FRAC review - GNM.xlsx"));

    const open = await request(app).post(`/v1/frac-reviews/${res.body.reviewId}/open-in-creator`).set(OWNER).expect(200);
    const again = await request(app).post(`/v1/frac-reviews/${res.body.reviewId}/open-in-creator`).set(OWNER).expect(200);
    expect(again.body.fracId).toBe(open.body.fracId);

    const frac = await request(app).get(`/v1/fracs/${open.body.fracId}`).set(OWNER).expect(200);
    expect(frac.body.frac).toMatchObject({ step: 6, imported: "GNM.xlsx" });
    expect(frac.body.frac.review).not.toBeNull();
  });
});

describe("creator", () => {
  async function createWithCompetencies(app: ReturnType<typeof setup>["app"]) {
    const created = await request(app).post("/v1/fracs").set(OWNER).send({ cadre: "ANM", state: "Bihar" }).expect(201);
    const id = created.body.id as string;
    await request(app)
      .patch(`/v1/fracs/${id}`)
      .set(OWNER)
      .send({ postings: [{ key: "P1", label: "ANM at Sub-Centre" }], roles, competencies })
      .expect(200);
    return id;
  }

  it("creates from a brief with defaults and validates it", async () => {
    const { app } = setup();
    const missing = await request(app).post("/v1/fracs").set(OWNER).send({ state: "Bihar" }).expect(400);
    expect(missing.body.error).toMatchObject({ code: "VALIDATION_FAILED", message: "cadre: Position is required" });
    const blank = await request(app).post("/v1/fracs").set(OWNER).send({ cadre: "  " }).expect(400);
    expect(blank.body.error.message).toBe("cadre: Position is required");
    await request(app).post("/v1/fracs").set(OWNER).send({ cadre: "ANM", size: "huge" }).expect(400);
    const res = await request(app).post("/v1/fracs").set(OWNER).send({ cadre: " ANM " }).expect(201);
    expect(res.body.frac).toMatchObject({ cadre: "ANM", state: "India (national baseline)", size: "standard", step: 1 });

    const list = await request(app).get("/v1/fracs").set(OWNER).expect(200);
    expect(list.body.fracs).toEqual([expect.objectContaining({ id: res.body.id, counts: { roles: 0, activities: 0, competencies: 0 } })]);
    await request(app).get(`/v1/fracs/${res.body.id}`).set(OTHER).expect(404);
  });

  it("marks roles dirty when roles change after competencies exist, and keeps the brief editable after research", async () => {
    const { app } = setup();
    const id = await createWithCompetencies(app);
    const edited = [{ ...roles[0], title: "Run VHSND sessions" }];
    const res = await request(app).patch(`/v1/fracs/${id}`).set(OWNER).send({ roles: edited }).expect(200);
    expect(res.body.frac.rolesDirty).toBe(true);

    // The team can confirm the mapping by hand; true is never accepted from the client
    const cleared = await request(app).patch(`/v1/fracs/${id}`).set(OWNER).send({ rolesDirty: false }).expect(200);
    expect(cleared.body.frac.rolesDirty).toBe(false);
    const refused = await request(app).patch(`/v1/fracs/${id}`).set(OWNER).send({ rolesDirty: true }).expect(400);
    expect(refused.body.error.code).toBe("VALIDATION_FAILED");

    await request(app).patch(`/v1/fracs/${id}`).set(OWNER).send({ research: { summary: "s" } }).expect(200);
    // The brief stays editable after research; the change is stamped so research shows as needing attention
    const briefEdit = await request(app).patch(`/v1/fracs/${id}`).set(OWNER).send({ cadre: "GNM" }).expect(200);
    expect(briefEdit.body.frac.changedAt.brief).toBeDefined();
    await request(app).patch(`/v1/fracs/${id}`).set(OWNER).send({ cadre: "ANM", codePrefix: "an-m9x" }).expect(200);
    const frac = await request(app).get(`/v1/fracs/${id}`).set(OWNER);
    expect(frac.body.frac.codePrefix).toBe("ANMX");
  });

  it("runs generation steps in order: 404 for unknown steps, 409 when a step is not ready, 400 for a bad body", async () => {
    const { app } = setup();
    const created = await request(app).post("/v1/fracs").set(OWNER).send({ cadre: "ANM" });
    const id = created.body.id as string;
    await request(app).post(`/v1/fracs/${id}/steps/publish`).set(OWNER).expect(404);
    const early = await request(app).post(`/v1/fracs/${id}/steps/roles`).set(OWNER).send({}).expect(409);
    expect(early.body.error).toEqual({ code: "STEP_NOT_READY", message: "Run job research before building roles" });
    const ladders = await request(app).post(`/v1/fracs/${id}/steps/ladders`).set(OWNER).send({}).expect(409);
    expect(ladders.body.error.code).toBe("STEP_NOT_READY");
    const bad = await request(app).post(`/v1/fracs/${id}/steps/research`).set(OWNER).send({ codes: "C1" }).expect(400);
    expect(bad.body.error.code).toBe("VALIDATION_FAILED");
    await request(app).post(`/v1/fracs/${id}/steps/research`).set(OTHER).send({}).expect(404);
    const info = await request(app).get("/v1/info").set(OWNER).expect(200);
    expect(info.body).toEqual({ aiProvider: "stub" });
  });

  it("allows one running job per FRAC and lets a reloaded page find it", async () => {
    const { app, runner, repos } = setup();
    const id = await createWithCompetencies(app);
    const now = new Date().toISOString();
    const live = "00000000-0000-4000-8000-000000000002";
    await repos.jobs.insert({ id: live, ownerId: "user-1", kind: "check", targetId: id, status: "running",
      msg: "", done: 0, total: 0, error: null, errorCode: null, usage: {}, createdAt: now, updatedAt: now });

    // A check or any step while that job reports in: 409 with the live job to follow
    const again = await request(app).post(`/v1/fracs/${id}/steps/check`).set(OWNER).expect(409);
    expect(again.body.error).toMatchObject({ code: "JOB_RUNNING", details: { jobId: live, kind: "check" } });
    const step = await request(app).post(`/v1/fracs/${id}/steps/ladders`).set(OWNER).send({ codes: ["C1"] }).expect(409);
    expect(step.body.error.code).toBe("JOB_RUNNING");
    expect((await request(app).get(`/v1/fracs/${id}`).set(OWNER)).body.activeJobId).toBe(live);

    await repos.jobs.update(live, { status: "done" });
    expect((await request(app).get(`/v1/fracs/${id}`).set(OWNER)).body.activeJobId).toBeNull();
    await request(app).post(`/v1/fracs/${id}/steps/check`).set(OWNER).expect(202);
    await runner.idle();
  });

  it("replaces a job that has gone silent instead of blocking the FRAC", async () => {
    const { app, runner, repos } = setup();
    const id = await createWithCompetencies(app);
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    await repos.jobs.insert({ id: "00000000-0000-4000-8000-000000000001", ownerId: "user-1", kind: "ladders", targetId: id, status: "running",
      msg: "", done: 0, total: 1, error: null, errorCode: null, usage: {}, createdAt: old, updatedAt: old });
    await request(app).post(`/v1/fracs/${id}/steps/check`).set(OWNER).expect(202);
    await runner.idle();
    expect(await repos.jobs.get("00000000-0000-4000-8000-000000000001")).toMatchObject({ status: "error", errorCode: "JOB_INTERRUPTED" });
  });

  it("runs the expert check, snapshots it, records it as a review and can roll back", async () => {
    const { app, runner } = setup();
    const empty = await request(app).post("/v1/fracs").set(OWNER).send({ cadre: "ANM" });
    await request(app).post(`/v1/fracs/${empty.body.id}/steps/check`).set(OWNER).expect(400);

    const id = await createWithCompetencies(app);
    const started = await request(app).post(`/v1/fracs/${id}/steps/check`).set(OWNER).expect(202);
    await runner.idle();
    const job = await request(app).get(`/v1/jobs/${started.body.jobId}`).set(OWNER);
    expect(job.body.status).toBe("done");

    const frac = await request(app).get(`/v1/fracs/${id}`).set(OWNER);
    expect(frac.body.frac.step).toBe(6);
    expect(frac.body.frac.review.checks).toHaveLength(5);

    const reviews = await request(app).get("/v1/frac-reviews").set(OWNER);
    expect(reviews.body.reviews).toEqual([expect.objectContaining({ kind: "expert-check", fracId: id })]);

    const versions = await request(app).get(`/v1/fracs/${id}/versions`).set(OWNER).expect(200);
    expect(versions.body.versions[0]).toMatchObject({ reason: "Expert check", step: 6 });

    await request(app).patch(`/v1/fracs/${id}`).set(OWNER).send({ competencies: [] });
    const restored = await request(app)
      .post(`/v1/fracs/${id}/versions/${versions.body.versions[0].id}/restore`)
      .set(OWNER)
      .expect(200);
    expect(restored.body.frac.competencies).toHaveLength(1);
    await request(app).post(`/v1/fracs/${id}/versions/999/restore`).set(OWNER).expect(404);
    await request(app).post(`/v1/fracs/${id}/versions/abc/restore`).set(OWNER).expect(400);
  });

  it("exports the FRAC workbook with the spec filename", async () => {
    const { app } = setup();
    const id = await createWithCompetencies(app);
    const res = await request(app).get(`/v1/fracs/${id}/export.xlsx`).set(OWNER).expect(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.headers["content-disposition"]).toContain(encodeURIComponent("ANM competencies - Bihar.xlsx"));
  });
});
