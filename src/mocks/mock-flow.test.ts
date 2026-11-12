// End-to-end flow on the mock AI provider, over HTTP: brief → research → roles & activities →
// competencies → level ladders → expert check → Excel → re-import through the Reviewer. Asserts the
// spec rules each step must hold (sections 5.2–5.6, 6.4, 7). The same steps run on Claude once an API
// key is set; only the answers differ. Deleted together with the rest of src/mocks.
import ExcelJS from "exceljs";
import request from "supertest";
import { createApp } from "../app.ts";
import { loadReviewRules } from "../config/review-rules.ts";
import { createMockProvider, seedMockData } from "./index.ts";
import { memoryRepositories } from "../repositories/index.ts";
import { ChecklistReviewer } from "../services/ai-review.service.ts";
import { DocumentService } from "../services/document.service.ts";
import { FracService } from "../services/frac.service.ts";
import { JobRunner } from "../services/queue/job-runner.ts";
import { ReviewService } from "../services/review.service.ts";

const OWNER = { "x-aastrika-creator": "mock-user" };

function setup() {
  const repos = memoryRepositories();
  const runner = new JobRunner(repos.jobs);
  const provider = createMockProvider();
  const reviews = new ReviewService(repos, runner, new ChecklistReviewer(provider), () => loadReviewRules());
  const fracs = new FracService(repos, runner, reviews, () => "Method text", provider);
  return { app: createApp({ fracs, documents: new DocumentService(repos, fracs), reviews, jobs: repos.jobs, provider }), runner, fracs, reviews };
}

type App = ReturnType<typeof setup>["app"];

/** Starts a step, waits for its job, and returns the finished job. */
async function step(app: App, runner: JobRunner, id: string, name: string, body: object = {}) {
  const started = await request(app).post(`/v1/fracs/${id}/steps/${name}`).set(OWNER).send(body).expect(202);
  await runner.idle();
  const job = await request(app).get(`/v1/jobs/${started.body.jobId}`).set(OWNER).expect(200);
  expect(job.body).toMatchObject({ status: "done", error: null });
  return job.body;
}

const getFrac = async (app: App, id: string) => (await request(app).get(`/v1/fracs/${id}`).set(OWNER).expect(200)).body.frac;

describe("full flow on the mock AI provider", () => {
  it("builds a complete ANM FRAC step by step, checks it and round-trips the export", async () => {
    const { app, runner } = setup();
    const created = await request(app).post("/v1/fracs").set(OWNER).send({ cadre: "ANM", state: "Bihar", size: "compact" }).expect(201);
    const id = created.body.id as string;

    // Step 2: research (spec 5.2 post-processing)
    const research = await step(app, runner, id, "research");
    // The mock prices its estimated tokens at Claude rates and marks the cost as an estimate
    expect(research.usage).toMatchObject({ calls: 1, estimated: 1, webSearches: 0 });
    expect(research.usage.costUsd).toBeGreaterThan(0);
    let frac = await getFrac(app, id);
    expect(frac.codePrefix).toBe("ANM");
    expect(frac.postings.map((p: { key: string }) => p.key)).toEqual(["P1", "P2"]);
    expect(frac.research.assumptions).toMatch(/^VERIFY: /m);
    expect(frac.research.authorised.split("\n").length).toBeGreaterThan(1);
    // The brief stays editable after research (the change is stamped); put it back for the rest of the flow
    await request(app).patch(`/v1/fracs/${id}`).set(OWNER).send({ cadre: "GNM" }).expect(200);
    await request(app).patch(`/v1/fracs/${id}`).set(OWNER).send({ cadre: "ANM" }).expect(200);

    // Step 3: roles then activities in batches of 4 (spec 5.3)
    const roles = await step(app, runner, id, "roles");
    frac = await getFrac(app, id);
    expect(frac.roles).toHaveLength(7);
    const activities = frac.roles.flatMap((r: { activities: { code: string; comp: string; postings: object }[] }) => r.activities);
    expect(activities).toHaveLength(35);
    expect(activities.map((a: { code: string }) => a.code)).toEqual(activities.map((_: unknown, i: number) => `A${i + 1}`));
    expect(activities.every((a: { comp: string }) => a.comp === "")).toBe(true);
    expect(Object.keys(activities[0].postings)).toEqual(["P1", "P2"]);
    expect(roles.usage.calls).toBe(1 + 2); // 1 roles call + 2 activity batches (4 + 3 roles)

    // Step 4: competencies; every activity mapped, every competency used (spec 5.4)
    await step(app, runner, id, "competencies");
    frac = await getFrac(app, id);
    expect(frac.competencies).toHaveLength(18);
    expect(frac.competencies[0].code).toBe("ANM1");
    const mapped = frac.roles.flatMap((r: { activities: { comp: string }[] }) => r.activities.map((a) => a.comp));
    expect(mapped.every((c: string) => /^ANM\d+@L[3-5]$/.test(c))).toBe(true);
    const used = new Set(mapped.map((c: string) => c.split("@")[0]));
    expect(frac.competencies.every((c: { code: string }) => used.has(c.code))).toBe(true);
    expect(frac.competencies.every((c: { levels: unknown }) => c.levels === null)).toBe(true);

    // Step 5: ladders, 4 per batch, progress counts competencies (spec 5.5)
    const ladders = await step(app, runner, id, "ladders");
    expect(ladders).toMatchObject({ done: 18, total: 18 });
    frac = await getFrac(app, id);
    for (const c of frac.competencies) {
      expect(c.levels).toHaveLength(5);
      expect(c.levels[4].label).toMatch(/^(Audits|Models)/);
    }

    // Step 6: expert check = rule-based checks + Vidya's checklist (rules r3 §4–7)
    const started = await request(app).post(`/v1/fracs/${id}/steps/check`).set(OWNER).expect(202);
    await runner.idle();
    const check = await request(app).get(`/v1/jobs/${started.body.jobId}`).set(OWNER);
    // 18 laddered competencies in batches of 6, plus the Bihar state-fit call
    expect(check.body.usage.calls).toBe(4);
    frac = await getFrac(app, id);
    expect(frac.step).toBe(6);
    const agent = frac.review.findings.filter((f: { source: string }) => f.source === "agent");
    expect(agent.map((f: { title: string }) => f.title)).toContain("Does not reflect Bihar");
    expect(agent.length).toBeLessThanOrEqual(3);
    expect(agent.every((f: { refs: string[] }) => f.refs.every((r) => /^(A|ANM)\d+$/.test(r)))).toBe(true);
    expect(frac.review).toMatchObject({ engine: "r3", fingerprint: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(frac.review.verdict).toMatch(/^(Revise before use|Usable with minor edits|Rebuild from the job before use) — /);
    expect(frac.review.strengths.length).toBeGreaterThan(0);
    expect(frac.log.map((l: { step: number }) => l.step)).toEqual([2, 3, 4, 5]);

    // Download, then re-import through the Reviewer (spec 7 round trip)
    const file = await request(app).get(`/v1/fracs/${id}/export.xlsx`).set(OWNER).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    }).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["FRAC", "Competencies", "Method & Sources", "Expert check"]);
    const upload = await request(app).post("/v1/frac-reviews").set(OWNER).attach("file", file.body, "ANM competencies - Bihar.xlsx").expect(202);
    await runner.idle();
    const reviewed = await request(app).get(`/v1/frac-reviews/${upload.body.reviewId}`).set(OWNER).expect(200);
    expect(reviewed.body.sourceModel.competencies).toHaveLength(18);
    expect(reviewed.body.report.stats).toMatchObject({ roles: 7, activities: 35, competencies: 18 });

    // Same file, same review (rules r3 §9): the stored review comes back without a job
    const again = await request(app).post("/v1/frac-reviews").set(OWNER).attach("file", file.body, "ANM competencies - Bihar.xlsx").expect(200);
    expect(again.body).toMatchObject({ reviewId: upload.body.reviewId, jobId: null, fromCache: true });
    // "Run a fresh review" asks again and replaces the stored report
    const fresh = await request(app).post(`/v1/frac-reviews/${upload.body.reviewId}/rerun`).set(OWNER).expect(202);
    expect(fresh.body.jobId).toEqual(expect.any(String));
    await runner.idle();
  });

  it("revises with feedback, keeps team-added activities and rewrites only the named ladders", async () => {
    const { app, runner } = setup();
    const id = (await request(app).post("/v1/fracs").set(OWNER).send({ cadre: "ANM", size: "compact" })).body.id as string;
    for (const s of ["research", "roles", "competencies", "ladders"]) await step(app, runner, id, s);

    // Research revise records the feedback (log + version)
    await step(app, runner, id, "research", { feedback: "Add the state's 104 helpline" });
    let frac = await getFrac(app, id);
    expect(frac.research.sourceNotes).toContain("Add the state's 104 helpline");
    expect(frac.log.at(-1)).toMatchObject({ step: 2, feedback: "Add the state's 104 helpline" });
    const versions = await request(app).get(`/v1/fracs/${id}/versions`).set(OWNER);
    expect(versions.body.versions[0].reason).toBe("Job research (revised)");

    // A team-added activity survives a roles revise; competencies are kept and flagged (gap 2)
    const roles = frac.roles.map((r: { activities: object[] }, i: number) =>
      i === 0 ? { ...r, activities: [...r.activities, { code: "", text: "Hold a team huddle", postings: {}, source: "Added by team", tier: "", comp: "" }] } : r);
    await request(app).patch(`/v1/fracs/${id}`).set(OWNER).send({ roles }).expect(200);
    await step(app, runner, id, "roles", { feedback: "Shorter titles" });
    frac = await getFrac(app, id);
    expect(frac.roles[0].activities.some((a: { text: string }) => a.text === "Hold a team huddle")).toBe(true);
    expect(frac.competencies).toHaveLength(18);
    expect(frac.rolesDirty).toBe(true);

    // Re-derive: ladders kept where code and label are unchanged
    await step(app, runner, id, "competencies");
    frac = await getFrac(app, id);
    expect(frac.rolesDirty).toBe(false);
    expect(frac.competencies.every((c: { levels: unknown[] | null }) => c.levels?.length === 5)).toBe(true);

    // "Revise ANM2": only that ladder changes
    const before = frac.competencies[0].levels;
    const ladders = await step(app, runner, id, "ladders", { codes: ["ANM2"], feedback: "Add a record-audit indicator" });
    expect(ladders).toMatchObject({ done: 1, total: 1 });
    frac = await getFrac(app, id);
    expect(frac.competencies[1].levels[2].desc).toContain("Add a record-audit indicator");
    expect(frac.competencies[0].levels).toEqual(before);
  });

  it("marks the expert check out of date after a fix or a hand edit, until it is run again", async () => {
    const { app, runner } = setup();
    const id = (await request(app).post("/v1/fracs").set(OWNER).send({ cadre: "ANM", size: "compact" })).body.id as string;
    for (const s of ["research", "roles", "competencies", "ladders", "check"]) await step(app, runner, id, s);
    let frac = await getFrac(app, id);
    expect(frac.review).not.toBeNull();
    expect(frac.reviewStale).toBe(false);

    // "Fix these competencies" rewrites ladders; the old findings stay visible but out of date
    await step(app, runner, id, "ladders", { codes: ["ANM2"], feedback: "Competencies are too broadly defined" });
    frac = await getFrac(app, id);
    expect(frac.review).not.toBeNull();
    expect(frac.reviewStale).toBe(true);

    await step(app, runner, id, "check");
    expect((await getFrac(app, id)).reviewStale).toBe(false);

    // Re-sending unchanged content is not a change; renaming a competency is
    frac = await getFrac(app, id);
    const same = await request(app).patch(`/v1/fracs/${id}`).set(OWNER).send({ competencies: frac.competencies }).expect(200);
    expect(same.body.frac.reviewStale).toBe(false);
    const renamed = frac.competencies.map((c: { label: string }, i: number) => (i === 0 ? { ...c, label: "Antenatal contacts to protocol" } : c));
    const edited = await request(app).patch(`/v1/fracs/${id}`).set(OWNER).send({ competencies: renamed }).expect(200);
    expect(edited.body.frac.reviewStale).toBe(true);
  });

  it("follows the brief's scope: postings it names, matching roles and competencies first", async () => {
    const { app, runner } = setup();
    const scope = "Village outreach and delivery point PHC; focus on immunisation and NCD screening";
    const id = (await request(app).post("/v1/fracs").set(OWNER).send({ cadre: "ANM", state: "Bihar", size: "compact", prompt: scope })).body.id as string;
    await step(app, runner, id, "research");
    let frac = await getFrac(app, id);
    expect(frac.postings.map((p: { label: string }) => p.label)).toEqual(["ANM in the village (community outreach)", "ANM at delivery-point PHC"]);
    expect(frac.research.summary).toContain(scope);
    expect(frac.research.assumptions).toContain(`Scope taken from the brief: ${scope}`);

    await step(app, runner, id, "roles");
    frac = await getFrac(app, id);
    expect(frac.roles.some((r: { title: string }) => /immuni[sz]/i.test(r.title))).toBe(true);
  });

  it("seeds a finished FRAC and a review for each owner", async () => {
    const { app, runner, fracs, reviews } = setup();
    await seedMockData({ fracs, reviews, runner }, ["mock-user"]);
    const list = await request(app).get("/v1/fracs").set(OWNER).expect(200);
    expect(list.body.fracs).toEqual([expect.objectContaining({ cadre: "ANM", state: "Bihar", step: 6 })]);
    const revs = await request(app).get("/v1/frac-reviews").set(OWNER).expect(200);
    expect(revs.body.reviews.map((r: { kind: string }) => r.kind).sort()).toEqual(["expert-check", "upload"]);
  });
});
