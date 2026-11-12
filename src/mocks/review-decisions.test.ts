// The review decisions of Nov 2026 end to end on the mock provider, over HTTP: the agent chooses the size,
// brief documents feed research with fewer searches, standard Roles / Competencies / Sources sheets replace
// AI calls, the templates import cleanly, and position matching seeds a new FRAC. A recording wrapper counts
// which AI tasks each step really called. Deleted together with the rest of src/mocks.
import ExcelJS from "exceljs";
import request from "supertest";
import { createApp } from "../app.ts";
import { loadReviewRules } from "../config/review-rules.ts";
import { createMockProvider } from "./index.ts";
import type { CompletionRequest, TextProvider } from "../providers/text/types.ts";
import { memoryRepositories } from "../repositories/index.ts";
import { ChecklistReviewer } from "../services/ai-review.service.ts";
import { DocumentService } from "../services/document.service.ts";
import { FracService } from "../services/frac.service.ts";
import { JobRunner } from "../services/queue/job-runner.ts";
import { ReviewService } from "../services/review.service.ts";
import { readWorkbook } from "../services/excel/workbook-reader.ts";

const OWNER = { "x-aastrika-creator": "mock-user" };
const OTHER = { "x-aastrika-creator": "someone-else" };

function setup() {
  const repos = memoryRepositories();
  const runner = new JobRunner(repos.jobs);
  const mock = createMockProvider();
  const calls: CompletionRequest[] = [];
  const provider: TextProvider = { name: mock.name, complete: (r) => (calls.push(r), mock.complete(r)) };
  const reviews = new ReviewService(repos, runner, new ChecklistReviewer(provider), () => loadReviewRules());
  const fracs = new FracService(repos, runner, reviews, () => "Method text", provider);
  return { app: createApp({ fracs, documents: new DocumentService(repos, fracs), reviews, jobs: repos.jobs, provider }), runner, repos, calls };
}

type Ctx = ReturnType<typeof setup>;

async function step({ app, runner }: Ctx, id: string, name: string, body: object = {}) {
  const started = await request(app).post(`/v1/fracs/${id}/steps/${name}`).set(OWNER).send(body).expect(202);
  await runner.idle();
  const job = await request(app).get(`/v1/jobs/${started.body.jobId}`).set(OWNER).expect(200);
  expect(job.body).toMatchObject({ status: "done", error: null });
  return job.body;
}

const getFrac = async ({ app }: Ctx, id: string) => (await request(app).get(`/v1/fracs/${id}`).set(OWNER).expect(200)).body.frac;
const create = async ({ app }: Ctx, body: object) => (await request(app).post("/v1/fracs").set(OWNER).send(body).expect(201)).body.id as string;
const tasksSince = (ctx: Ctx, from: number) => ctx.calls.slice(from).map((c) => c.task);

async function xlsx(name: string, rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet(name).addRows(rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A binary download (template .xlsx) as a Buffer. */
const download = async (ctx: Ctx, path: string): Promise<Buffer> =>
  (
    await request(ctx.app).get(path).set(OWNER).expect(200).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    })
  ).body as Buffer;

const upload = (ctx: Ctx, id: string, kind: string, file: Buffer, name: string) =>
  request(ctx.app).post(`/v1/fracs/${id}/documents`).set(OWNER).field("kind", kind).attach("file", file, name);

const ROLES_SHEET = [
  ["Role", "Activity", "P1: ANM at Sub-Centre", "P2: ANM at PHC", "Source", "Source tier"],
  ["R1", "Provide immunisation services", "", "", "UIP", ""],
  ["A1", "Conduct immunisation sessions as per the UIP schedule", "Yes", "y", "UIP", "programme guideline"],
  ["A2", "Maintain the cold chain at the session site", "yes", "No", "UIP", "JD"],
  ["R2", "Maintain records and reports", "", "", "RCH portal", ""],
];

describe("review decisions on the mock provider", () => {
  it("lets the agent choose the size when the brief leaves it out", async () => {
    const ctx = setup();
    const id = await create(ctx, { cadre: "ANM", state: "Bihar" });
    expect(await getFrac(ctx, id)).toMatchObject({ size: "standard", sizeBy: "agent" });
    await step(ctx, id, "research");
    expect(ctx.calls[0].prompt).toContain("Size: decide from the research");
    expect(await getFrac(ctx, id)).toMatchObject({ size: "compact", sizeBy: "agent", sizeReason: expect.stringContaining("focused") });

    // A size picked on the brief (older portal) is kept as the team's
    const team = await create(ctx, { cadre: "ANM", size: "full" });
    await step(ctx, team, "research");
    expect(await getFrac(ctx, team)).toMatchObject({ size: "full", sizeBy: "team" });
  });

  it("reads brief documents into research with fewer web searches, and locks them once research exists", async () => {
    const ctx = setup();
    const id = await create(ctx, { cadre: "ANM", state: "Bihar" });
    const jd = Buffer.from("Position: ANM, Sub-Centre, NHM Bihar\nDuties:\n- Conduct immunisation sessions\n- Register pregnant women");
    const added = await upload(ctx, id, "brief", jd, "ANM JD.txt").expect(201);
    expect(added.body.document).toMatchObject({ kind: "brief", filename: "ANM JD.txt", chars: jd.toString().length });
    expect(added.body.document.text).toBeUndefined();
    await upload(ctx, id, "brief", Buffer.from("x"), "old.doc").expect(400);

    const job = await step(ctx, id, "research");
    // First a read of the document alone (no search), then research for only what it leaves out
    expect(ctx.calls.map((c) => c.task)).toEqual(["research-documents", "research"]);
    expect(ctx.calls[0]).toMatchObject({ tier: "default" });
    expect(ctx.calls[0].prompt).toContain("TEAM DOCUMENTS (read these only)");
    expect(ctx.calls[0].prompt).toContain("Register pregnant women");
    expect(ctx.calls[0].searchMaxUses).toBeUndefined();
    const gaps = ctx.calls[1];
    expect(gaps.searchMaxUses).toBe(1);
    expect(gaps.prompt).not.toContain("Position: ANM, Sub-Centre, NHM Bihar");
    expect(gaps.prompt).toContain("NOT COVERED (research these): stateContext, sources");
    expect(gaps.prompt).toContain("PARTLY COVERED (complete these, keeping everything already there): notAuthorised");
    expect(gaps.prompt).toContain("POSTINGS: decided from the brief and the documents, not researched");
    expect(job.usage.calls).toBe(2);
    const researched = (await getFrac(ctx, id)).research;
    expect(researched.origin).toEqual({
      documents: ["cadreFull", "summary", "postings", "authorised", "notAuthorised"],
      agent: ["notAuthorised", "stateContext", "sources"],
    });
    expect(researched.sources[0]).toMatchObject({ title: "ANM JD.txt", issuer: "Team document", tier: "JD" });
    expect(researched.sources.length).toBeGreaterThan(1);
    expect(researched.stateContext).not.toBe("");

    // After research a document can still be added; it marks the brief changed, so research needs a look
    const later = await upload(ctx, id, "brief", jd, "more.txt").expect(201);
    expect(later.body.frac.changedAt.brief).toBeDefined();
    const list = await request(ctx.app).get(`/v1/fracs/${id}/documents`).set(OWNER).expect(200);
    expect(list.body.documents).toHaveLength(2);
    await request(ctx.app).get(`/v1/fracs/${id}/documents`).set(OTHER).expect(404);
  });

  it("uses a Roles sheet: keeps its postings through research and writes activities only for empty roles", async () => {
    const ctx = setup();
    const id = await create(ctx, { cadre: "ANM", state: "Bihar", size: "compact" });
    const res = await upload(ctx, id, "roles", await xlsx("FRAC", ROLES_SHEET), "roles.xlsx").expect(201);
    expect(res.body.document.parsed.counts).toEqual({ roles: 2, activities: 2, postings: 2 });
    expect(res.body.document.parsed.warnings).toEqual(["1 role(s) have no activities; the Roles step will write them."]);
    expect(res.body.frac.postings).toEqual([{ key: "P1", label: "ANM at Sub-Centre" }, { key: "P2", label: "ANM at PHC" }]);
    expect(res.body.frac.roles[0].activities[0]).toMatchObject({ code: "A1", postings: { P1: "Yes", P2: "Yes" }, tier: "Programme guideline" });
    expect(res.body.frac.uploads).toEqual({ roles: "roles.xlsx" });

    await step(ctx, id, "research");
    expect((await getFrac(ctx, id)).postings.map((p: { label: string }) => p.label)).toEqual(["ANM at Sub-Centre", "ANM at PHC"]);

    const before = ctx.calls.length;
    await step(ctx, id, "roles");
    expect(tasksSince(ctx, before)).toEqual(["activities"]);
    const frac = await getFrac(ctx, id);
    expect(frac.roles[0].activities.map((a: { text: string }) => a.text)).toEqual(ROLES_SHEET.slice(2, 4).map((r) => r[1]));
    expect(frac.roles[1].activities.length).toBeGreaterThan(0);
    expect(frac.roles.flatMap((r: { activities: { code: string }[] }) => r.activities.map((a) => a.code))[2]).toBe("A3");

    // Removing the sheet hands the step back to the AI; the roles stay
    const doc = (await request(ctx.app).get(`/v1/fracs/${id}/documents`).set(OWNER)).body.documents[0];
    const removed = await request(ctx.app).delete(`/v1/fracs/${id}/documents/${doc.id}`).set(OWNER).expect(200);
    expect(removed.body.frac.uploads).toEqual({});
    expect(removed.body.frac.roles).toHaveLength(2);
  });

  it("uses a Competencies sheet: one mapping call, and ladders only for competencies without one", async () => {
    const ctx = setup();
    const id = await create(ctx, { cadre: "ANM", state: "Bihar", size: "compact" });
    await step(ctx, id, "research");
    await step(ctx, id, "roles");
    const template = await download(ctx, "/v1/templates/competencies");
    const res = await upload(ctx, id, "competencies", template, "competencies.xlsx").expect(201);
    expect(res.body.document.parsed).toMatchObject({ counts: { competencies: 2, ladders: 1 }, warnings: [] });
    expect(res.body.frac.rolesDirty).toBe(true);

    let before = ctx.calls.length;
    await step(ctx, id, "competencies");
    expect(tasksSince(ctx, before)).toEqual(["mapping"]);
    let frac = await getFrac(ctx, id);
    expect(frac.competencies.map((c: { code: string }) => c.code)).toEqual(["ANM1", "ANM2"]);
    expect(frac.competencies[0].levels).toHaveLength(5);
    expect(frac.roles.flatMap((r: { activities: { comp: string }[] }) => r.activities).every((a: { comp: string }) => /^ANM[12]@L[1-5]$/.test(a.comp))).toBe(true);

    before = ctx.calls.length;
    const ladders = await step(ctx, id, "ladders");
    expect(tasksSince(ctx, before)).toEqual(["ladders"]);
    expect(ladders.total).toBe(1);
    frac = await getFrac(ctx, id);
    expect(frac.competencies.every((c: { levels: unknown[] | null }) => c.levels?.length === 5)).toBe(true);
  });

  it("uses a Sources sheet in research with web search off", async () => {
    const ctx = setup();
    const id = await create(ctx, { cadre: "ANM", state: "Bihar" });
    const sheet = await xlsx("Sources", [
      ["Title", "Issuer", "Year", "Use", "Tier", "URL"],
      ["IPHS 2022", "MoHFW", "2022", "Staffing", "facility standard", "https://nhm.gov.in/iphs"],
      ["ANM job responsibilities", "MoHFW", "verify", "Duties", "JD", "ftp://example"],
    ]);
    const res = await upload(ctx, id, "sources", sheet, "sources.xlsx").expect(201);
    expect(res.body.document.parsed.warnings).toEqual(['The link for "ANM job responsibilities" is not a web address and was left out.']);
    expect(res.body.frac.research).toBeNull();

    await step(ctx, id, "research");
    expect(ctx.calls[0].searchMaxUses).toBe(0);
    expect(ctx.calls[0].prompt).toContain("SOURCES (the team's standard list");
    expect((await getFrac(ctx, id)).research.sources).toEqual([
      { title: "IPHS 2022", issuer: "MoHFW", year: "2022", use: "Staffing", tier: "Facility standard", url: "https://nhm.gov.in/iphs" },
      { title: "ANM job responsibilities", issuer: "MoHFW", year: "verify", use: "Duties", tier: "JD" },
    ]);
  });

  it("serves templates that import with no warnings, and refuses an upload while a step runs", async () => {
    const ctx = setup();
    const id = await create(ctx, { cadre: "ANM" });
    for (const kind of ["roles", "sources"]) {
      const t = await download(ctx, `/v1/templates/${kind}`);
      const sheets = await readWorkbook(t);
      expect(sheets.map((s) => s.name)).toContain("Instructions");
      const res = await upload(ctx, id, kind, t, `${kind}.xlsx`).expect(201);
      expect(res.body.document.parsed.warnings).toEqual([]);
    }
    const guide = await request(ctx.app).get("/v1/templates/brief").set(OWNER).expect(200);
    expect(guide.text).toContain("Duties and responsibilities");
    await request(ctx.app).get("/v1/templates/other").set(OWNER).expect(400);
    await upload(ctx, id, "roles", Buffer.from("Role,Activity\nR1,Do things\n"), "roles.csv").expect(201);
    const bad = await upload(ctx, id, "competencies", Buffer.from("a,b\n1,2\n"), "c.csv").expect(400);
    expect(bad.body.error.code).toBe("SHEET_NOT_RECOGNISED");

    const now = new Date().toISOString();
    await ctx.repos.jobs.insert({ id: "00000000-0000-4000-8000-000000000003", ownerId: "mock-user", kind: "research", targetId: id, status: "running",
      msg: "", done: 0, total: 0, error: null, errorCode: null, usage: {}, createdAt: now, updatedAt: now });
    const busy = await upload(ctx, id, "roles", Buffer.from("Role,Activity\nR1,Do things\n"), "roles.csv").expect(409);
    expect(busy.body.error.code).toBe("JOB_RUNNING");
  });

  it("matches a position exactly and seeds a new FRAC from it", async () => {
    const ctx = setup();
    const first = await create(ctx, { cadre: "ANM", state: "Bihar", size: "compact" });
    await step(ctx, first, "research");
    await step(ctx, first, "roles");
    await step(ctx, first, "competencies");
    const source = await getFrac(ctx, first);

    const hit = await request(ctx.app).get("/v1/fracs/match").query({ cadre: "  anm ", state: "Assam" }).set(OWNER).expect(200);
    expect(hit.body.match).toMatchObject({ id: first, cadre: "ANM", state: "Bihar", counts: { roles: source.roles.length } });
    expect(hit.body.match.roleTitles).toEqual(source.roles.map((r: { title: string }) => r.title));
    expect((await request(ctx.app).get("/v1/fracs/match").query({ cadre: "ANM Senior" }).set(OWNER)).body.match).toBeNull();
    expect((await request(ctx.app).get("/v1/fracs/match").query({ cadre: "ANM" }).set(OTHER)).body.match).toBeNull();

    const seeded = await create(ctx, { cadre: "ANM", state: "Assam", seed: { from: "frac", fracId: first } });
    let frac = await getFrac(ctx, seeded);
    expect(frac.seededFrom).toEqual({ from: "frac", ref: first, name: "ANM · Bihar", withRoles: true });
    expect(frac.postings).toEqual(source.postings);
    expect(frac.roles.map((r: { title: string }) => r.title)).toEqual(source.roles.map((r: { title: string }) => r.title));
    expect(frac.roles.flatMap((r: { activities: { comp: string }[] }) => r.activities).every((a: { comp: string }) => a.comp === "")).toBe(true);
    // Research keeps the matched postings; no roles call is needed afterwards
    await step(ctx, seeded, "research");
    expect((await getFrac(ctx, seeded)).postings).toEqual(source.postings);
    const before = ctx.calls.length;
    await step(ctx, seeded, "roles");
    expect(tasksSince(ctx, before)).toEqual([]);

    await request(ctx.app).post("/v1/fracs").set(OTHER).send({ cadre: "ANM", seed: { from: "frac", fracId: first } }).expect(404);

    const fromPositions = await create(ctx, {
      cadre: "Staff Nurse",
      seed: { from: "positions", code: "POS12", name: "Staff Nurse", roles: [{ title: "Provide ward care", activities: ["Monitor vital signs"] }, { title: "Maintain records" }] },
    });
    frac = await getFrac(ctx, fromPositions);
    expect(frac.seededFrom).toEqual({ from: "positions", ref: "POS12", name: "Staff Nurse", withRoles: true });
    expect(frac.roles[0]).toMatchObject({ code: "R1", title: "Provide ward care", source: "Positions master", activities: [{ code: "A1", text: "Monitor vital signs" }] });
    expect(frac.roles[1].activities).toEqual([]);
  });

  it("copies only the postings when the roles are left unticked", async () => {
    const ctx = setup();
    const first = await create(ctx, { cadre: "ANM", state: "Bihar", size: "compact" });
    await step(ctx, first, "research");
    await step(ctx, first, "roles");
    const source = await getFrac(ctx, first);
    const seeded = await create(ctx, { cadre: "ANM", state: "Assam", seed: { from: "frac", fracId: first, withRoles: false } });
    const frac = await getFrac(ctx, seeded);
    expect(frac.seededFrom).toMatchObject({ ref: first, withRoles: false });
    expect(frac.postings).toEqual(source.postings);
    expect(frac.roles).toEqual([]);
  });

  it("rebuilds copied roles from research when a job description is attached, and can clear them", async () => {
    const ctx = setup();
    const first = await create(ctx, { cadre: "ANM", state: "Bihar", size: "compact" });
    await step(ctx, first, "research");
    await step(ctx, first, "roles");
    const seeded = await create(ctx, { cadre: "ANM", state: "Assam", seed: { from: "frac", fracId: first } });
    await upload(ctx, seeded, "brief", Buffer.from("Position: ANM, Assam\nDuties:\n- Run VHSND sessions"), "JD.txt").expect(201);
    await step(ctx, seeded, "research");
    const before = ctx.calls.length;
    await step(ctx, seeded, "roles");
    expect(tasksSince(ctx, before)[0]).toBe("roles");
    expect((await getFrac(ctx, seeded)).seededFrom.withRoles).toBe(false);

    // Clearing copied roles by hand, before research
    const other = await create(ctx, { cadre: "ANM", state: "Kerala", seed: { from: "frac", fracId: first } });
    const cleared = await request(ctx.app).patch(`/v1/fracs/${other}`).set(OWNER).send({ clearCopiedRoles: true }).expect(200);
    expect(cleared.body.frac.roles).toEqual([]);
    expect(cleared.body.frac.seededFrom.withRoles).toBe(false);
    expect(cleared.body.frac.postings.length).toBeGreaterThan(0);
  });
});
