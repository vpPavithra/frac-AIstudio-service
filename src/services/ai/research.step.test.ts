// Unit tests for research with team documents: which parts the documents cover, how the document read and the
// gap research merge, and that research is skipped when the documents and a Sources sheet cover everything.
import type { z } from "zod/v4";
import type { FracDocument } from "../../models/document.model.ts";
import type { Frac } from "../../models/frac.model.ts";
import type { CompletionRequest } from "../../providers/text/types.ts";
import { newFrac } from "../frac.service.ts";
import { mergeResearch, researchPatch, runResearch, splitCoverage } from "./research.step.ts";
import { documentReadOutput, researchOutput } from "./schemas.ts";
import type { StepContext } from "./step-context.ts";

type Read = z.infer<typeof documentReadOutput>;

const read = (coverage: Partial<Read["coverage"]> = {}, extra: Partial<Read> = {}): Read => documentReadOutput.parse({
  cadreFull: "Auxiliary Nurse Midwife",
  codePrefix: "ANM",
  summary: "From the JD",
  postings: [{ key: "P1", label: "ANM at Sub-Centre" }],
  authorised: ["Immunise"],
  notAuthorised: ["Prescribe"],
  sourceNotes: "JD dated 2024",
  coverage,
  ...extra,
});

const gap = (extra: Partial<z.infer<typeof researchOutput>> = {}) => researchOutput.parse({
  cadreFull: "Other name",
  summary: "Researched summary",
  postings: [{ key: "P1", label: "ANM at Sub-Centre" }, { key: "P2", label: "ANM at PHC" }],
  authorised: ["Immunise", "Screen"],
  notAuthorised: ["Prescribe", "Perform deliveries alone"],
  stateContext: ["Bihar: Mission Indradhanush"],
  sources: [{ title: "IPHS 2022", issuer: "MoHFW", url: "https://mohfw.gov.in/iphs" }],
  ...extra,
});

describe("splitCoverage", () => {
  it("groups the parts by coverage, with sources missing unless a Sources sheet was uploaded", () => {
    const r = read({ cadreFull: "found", summary: "found", authorised: "partial" });
    expect(splitCoverage(r, { sources: false, postings: false })).toEqual({
      found: ["cadreFull", "summary", "postings"],
      partial: ["authorised"],
      missing: ["notAuthorised", "stateContext", "sources"],
    });
    expect(splitCoverage(r, { sources: true, postings: true }).found).toEqual(["cadreFull", "summary", "postings", "sources"]);
  });
});

describe("mergeResearch", () => {
  it("keeps covered parts from the documents, adds to partly covered lists and takes the rest from research", () => {
    const r = read({ cadreFull: "found", summary: "found", authorised: "partial", notAuthorised: "found" });
    const split = splitCoverage(r, { sources: false, postings: false });
    const out = mergeResearch(r, gap(), split, ["ANM JD.pdf"]);
    expect(out.cadreFull).toBe("Auxiliary Nurse Midwife");
    expect(out.summary).toBe("From the JD");
    expect(out.notAuthorised).toEqual(["Prescribe"]);
    expect(out.authorised).toEqual(["Immunise", "Screen"]);
    expect(out.postings).toEqual([{ key: "P1", label: "ANM at Sub-Centre" }]); // the read's, never researched
    expect(out.stateContext).toEqual(["Bihar: Mission Indradhanush"]);
    expect(out.sources.map((s) => s.title)).toEqual(["ANM JD.pdf", "IPHS 2022"]);
  });

  it("falls back to the documents when research leaves a part empty, and works with no research at all", () => {
    const r = read({ summary: "partial" });
    const split = splitCoverage(r, { sources: true, postings: false });
    expect(mergeResearch(r, gap({ summary: "" }), split, []).summary).toBe("From the JD");
    expect(mergeResearch(r, null, split, ["JD.txt"])).toMatchObject({ summary: "From the JD", stateContext: [], sources: [{ title: "JD.txt" }] });
  });
});

describe("postings", () => {
  it("are never researched: none named means none, and the agent's are ignored", () => {
    const r = read({}, { postings: [] });
    const split = splitCoverage(r, { sources: false, postings: false });
    expect([...split.found, ...split.partial, ...split.missing]).not.toContain("postings");
    expect(mergeResearch(r, gap(), split, []).postings).toEqual([]);
  });

  it("can be none after research, and the team's own are kept when the brief names none", () => {
    const f = newFrac("o", { cadre: "GNM", state: "Bihar", prompt: "" }, "f1", new Date());
    const out = researchOutput.parse({ postings: [] });
    expect(researchPatch(f, out).postings).toEqual([]);
    const own = [{ key: "P1", label: "Ward" }];
    expect(researchPatch({ ...f, postings: own }, out).postings).toEqual(own);
    expect(researchPatch({ ...f, postings: own }, researchOutput.parse({ postings: [{ key: "P1", label: "Labour room" }] })).postings)
      .toEqual([{ key: "P1", label: "Labour room" }]);
  });
});

describe("runResearch with documents", () => {
  const doc = (kind: FracDocument["kind"], parsed: FracDocument["parsed"] = null) =>
    ({ id: kind, fracId: "f1", ownerId: "o", kind, filename: `${kind}.txt`, mime: "text/plain", bytes: 1, text: "JD text", parsed, createdAt: "" }) as FracDocument;

  function context(frac: Frac, documents: FracDocument[], answers: Record<string, unknown>) {
    const calls: CompletionRequest[] = [];
    const ctx: StepContext = {
      frac,
      documents,
      provider: { name: "test", complete: async (r) => (calls.push(r), { json: answers[r.task], model: "t", usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0 }) },
      progress: async () => undefined,
      recordUsage: async () => undefined,
      save: async () => frac,
    };
    return { ctx, calls };
  }

  it("skips the research call when the documents and a Sources sheet cover everything", async () => {
    const all = { cadreFull: "found", summary: "found", postings: "found", authorised: "found", notAuthorised: "found", stateContext: "found" } as const;
    const frac = { ...newFrac("o", { cadre: "ANM", state: "Bihar", prompt: "" }, "f1", new Date()), uploads: { sources: "s.xlsx" } };
    const sources = [{ title: "UIP guidelines", issuer: "MoHFW", year: "2024", use: "", tier: "Programme guideline" }];
    const { ctx, calls } = context(frac, [doc("brief"), doc("sources", { sources } as FracDocument["parsed"])], {
      "research-documents": read(all, { stateContext: ["Bihar"] }),
    });
    const patch = await runResearch(ctx);
    expect(calls.map((c) => c.task)).toEqual(["research-documents"]);
    expect(patch.research).toMatchObject({ summary: "From the JD", sources, origin: { documents: ["cadreFull", "summary", "postings", "authorised", "notAuthorised", "stateContext"], agent: [] } });
  });

  it("uses the single research call on revise with feedback", async () => {
    const frac = newFrac("o", { cadre: "ANM", state: "Bihar", prompt: "" }, "f1", new Date());
    const { ctx, calls } = context({ ...frac }, [doc("brief")], { research: gap() });
    ctx.feedback = "Add PHC posting";
    await runResearch(ctx);
    expect(calls.map((c) => c.task)).toEqual(["research"]);
    expect(calls[0].prompt).toContain("JD text");
  });
});
