// Spec 8 API end to end over HTTP, on the in-memory store and the computed-only reviewer.
import ExcelJS from "exceljs";
import request from "supertest";
import { ComputedOnlyReviewer } from "../src/agents/agent-reviewer.js";
import { createApp } from "../src/app.js";
import { loadOutdatedPatterns } from "../src/config/outdated.js";
import type { SheetData } from "../src/engine/parse-workbook.js";
import { NO_COMPETENCY_SHEET } from "../src/engine/parse-workbook.js";
import { JobRunner } from "../src/jobs/job-runner.js";
import { memoryRepositories } from "../src/repositories/memory.js";
import { FracService } from "../src/services/frac.service.js";
import { ReviewService } from "../src/services/review.service.js";
import { gnmSample } from "./support/sample-workbooks.js";
import { goodLevels } from "./support/test-data.js";

const OWNER = { "x-aastrika-creator": "user-1" };
const OTHER = { "x-aastrika-creator": "user-2" };

function setup() {
  const repos = memoryRepositories();
  const runner = new JobRunner(repos.jobs);
  const reviews = new ReviewService(repos, runner, new ComputedOnlyReviewer(), () => loadOutdatedPatterns());
  const fracs = new FracService(repos, runner, reviews, () => "Method text");
  return { app: createApp({ fracs, reviews, jobs: repos.jobs }), runner };
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

  it("rejects missing, non-xlsx, unreadable and sheet-less uploads with 400", async () => {
    const { app } = setup();
    await request(app).post("/v1/frac-reviews").set(OWNER).expect(400);
    await request(app).post("/v1/frac-reviews").set(OWNER).attach("file", Buffer.from("x"), "f.csv").expect(400);
    await request(app).post("/v1/frac-reviews").set(OWNER).attach("file", Buffer.from("not a zip"), "f.xlsx").expect(400);
    const noComp = await request(app)
      .post("/v1/frac-reviews")
      .set(OWNER)
      .attach("file", await xlsx([{ name: "Sheet1", rows: [["Role", "Activity"]] }]), "f.xlsx")
      .expect(400);
    expect(noComp.body.error).toBe(NO_COMPETENCY_SHEET);
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
    await request(app).post("/v1/fracs").set(OWNER).send({ state: "Bihar" }).expect(400);
    await request(app).post("/v1/fracs").set(OWNER).send({ cadre: "ANM", size: "huge" }).expect(400);
    const res = await request(app).post("/v1/fracs").set(OWNER).send({ cadre: " ANM " }).expect(201);
    expect(res.body.frac).toMatchObject({ cadre: "ANM", state: "India (national baseline)", size: "standard", step: 1 });

    const list = await request(app).get("/v1/fracs").set(OWNER).expect(200);
    expect(list.body.fracs).toEqual([expect.objectContaining({ id: res.body.id, counts: { roles: 0, activities: 0, competencies: 0 } })]);
    await request(app).get(`/v1/fracs/${res.body.id}`).set(OTHER).expect(404);
  });

  it("marks roles dirty when roles change after competencies exist, and locks the brief after research", async () => {
    const { app } = setup();
    const id = await createWithCompetencies(app);
    const edited = [{ ...roles[0], title: "Run VHSND sessions" }];
    const res = await request(app).patch(`/v1/fracs/${id}`).set(OWNER).send({ roles: edited }).expect(200);
    expect(res.body.frac.rolesDirty).toBe(true);

    await request(app).patch(`/v1/fracs/${id}`).set(OWNER).send({ research: { summary: "s" } }).expect(200);
    await request(app).patch(`/v1/fracs/${id}`).set(OWNER).send({ cadre: "GNM" }).expect(400);
    // Re-sending the unchanged brief is fine
    await request(app).patch(`/v1/fracs/${id}`).set(OWNER).send({ cadre: "ANM", codePrefix: "an-m9x" }).expect(200);
    const frac = await request(app).get(`/v1/fracs/${id}`).set(OWNER);
    expect(frac.body.frac.codePrefix).toBe("ANMX");
  });

  it("answers 501 for generation steps not built yet and 404 for unknown steps", async () => {
    const { app } = setup();
    const id = await createWithCompetencies(app);
    await request(app).post(`/v1/fracs/${id}/steps/research`).set(OWNER).expect(501);
    await request(app).post(`/v1/fracs/${id}/steps/publish`).set(OWNER).expect(404);
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
