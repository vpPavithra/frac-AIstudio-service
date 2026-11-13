// CREATOR STEP 2, job research (spec 5.2). Runs as a job started by FracService.startStep("research").
// One complex-tier call (Kaushal); when the provider profile has webSearch it may also search the
// government domains in RESEARCH_SEARCH_DOMAINS (see providers/text/claude.ts). The answer is validated against researchOutput,
// then researchPatch turns it into the FRAC's research, postings, cadreFull and codePrefix.
// With team documents attached (review, Nov 2026) it runs in two parts: a cheaper default-tier call reads the
// documents alone and says what they cover, then the research call (with web search) fills only the gaps, and is
// skipped when nothing is left. research.origin records which parts came from the documents and which from the agent.
// Flow: brief -> research -> roles & activities -> competencies -> ladders -> expert check.
import type { z } from "zod/v4";
import { DOCUMENTS, LIMITS } from "../../config/constants.ts";
import type { Frac, FracResearch, FracSize, FracSource, ResearchField } from "../../models/frac.model.ts";
import type { Citation } from "../../providers/text/types.ts";
import { sanitizeCodePrefix } from "../../utils/codes.ts";
import { JOB_MESSAGES } from "../queue/job-messages.ts";
import { documentReadPrompt, researchPrompt } from "./prompts.ts";
import { documentReadOutput, researchOutput } from "./schemas.ts";
import { linkSources } from "./source-links.ts";
import { callModel, type StepContext } from "./step-context.ts";

const SIZES: readonly FracSize[] = ["compact", "standard", "full"];

/** What the team fixed before research: a standard source list, and postings from a Roles sheet or a matched position. */
export interface ResearchFixed {
  sources?: FracSource[] | null;
  fixedPostings?: boolean;
  origin?: FracResearch["origin"];
}

type ResearchOut = z.infer<typeof researchOutput>;
type DocumentRead = z.infer<typeof documentReadOutput>;

/** The research parts a document read can fill, in the order the progress line names them. */
const DOCUMENT_FIELDS = ["cadreFull", "summary", "postings", "authorised", "notAuthorised", "stateContext"] as const;
const LIST_FIELDS = new Set<ResearchField>(["authorised", "notAuthorised", "stateContext"]);

/** How the job's progress line names each part. */
const FIELD_LABELS: Record<ResearchField, string> = {
  cadreFull: "full position name",
  summary: "job summary",
  postings: "postings",
  authorised: "authorised work",
  notAuthorised: "work to refer",
  stateContext: "state context",
  sources: "sources",
};

export interface Coverage {
  found: ResearchField[];
  partial: ResearchField[];
  missing: ResearchField[];
}

/**
 * Which parts the documents cover. Postings fixed by the team count as covered; sources are covered only by a
 * Sources sheet, because a job description is one source, not the guidelines research looks for. Postings are
 * never researched: the read takes them from the brief and documents, and when they name none the team adds them,
 * so they are left out of the split unless the documents give some.
 */
export function splitCoverage(read: DocumentRead, fixed: { sources: boolean; postings: boolean }): Coverage {
  const split: Coverage = { found: [], partial: [], missing: [] };
  for (const field of DOCUMENT_FIELDS) {
    if (field === "postings") {
      if (fixed.postings || read.postings.length) split.found.push(field);
      continue;
    }
    split[read.coverage[field]].push(field);
  }
  (fixed.sources ? split.found : split.missing).push("sources");
  return split;
}

/** The team's documents as sources: research read them first. */
export const documentSources = (names: string[]): ResearchOut["sources"] =>
  names.map((title) => ({ title, issuer: "Team document", year: "", use: "Job description supplied by the team", tier: "JD", url: "" }));

const unique = (lines: string[]) => [...new Set(lines.map((l) => l.trim()).filter(Boolean))];

/**
 * One research answer from the document read and the gap research (null when it was skipped). A covered part
 * keeps the documents' text; a partly covered list keeps the documents' lines and adds the new ones; anything
 * else takes the research answer, falling back to the documents when research left it empty. Pure.
 */
export function mergeResearch(read: DocumentRead, gap: ResearchOut | null, split: Coverage, docNames: string[]): ResearchOut {
  // `coverage` rides along unused; researchPatch reads only the research fields
  const out: ResearchOut = { ...read, sources: [], ...(gap ?? {}) };
  const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim() !== "");
  for (const field of DOCUMENT_FIELDS) {
    const mine = read[field];
    const theirs = gap?.[field];
    if (split.found.includes(field) || !filled(theirs)) {
      Object.assign(out, { [field]: mine });
    } else if (split.partial.includes(field) && LIST_FIELDS.has(field)) {
      Object.assign(out, { [field]: unique([...(mine as string[]), ...(theirs as string[])]) });
    }
  }
  return {
    ...out,
    postings: read.postings, // decided by the read from the brief and documents, never researched
    codePrefix: gap?.codePrefix || read.codePrefix,
    size: gap?.size || read.size,
    sizeReason: gap?.size ? gap.sizeReason : read.sizeReason,
    sourceNotes: unique([read.sourceNotes, gap?.sourceNotes ?? ""]).join(" "),
    assumptions: unique([...read.assumptions, ...(gap?.assumptions ?? [])]),
    verify: unique([...read.verify, ...(gap?.verify ?? [])]),
    sources: [...documentSources(docNames), ...(gap?.sources ?? [])],
  };
}

/**
 * Spec 5.2 post-processing: sanitise codePrefix; keep every posting the brief and documents name, re-keyed P1, P2…
 * (none when they name none; LIMITS.maxPostings is only a safety limit, review 13 Nov 2026); join the lists into newline text; prefix each `verify` item
 * with "VERIFY: " and append it to the assumptions. Review decisions (Nov 2026): postings fixed by the team
 * are kept, a standard source list replaces the model's, a source keeps its link only when it has one (runResearch
 * checks them first with linkSources), and an agent-chosen size is applied when the answer names a valid one.
 * Pure: the result is merged into the latest saved FRAC by FracService.startStep. A blank cadreFull or
 * codePrefix falls back to the brief's values. On revise everything here is replaced; the team's edits
 * reach the model only through the PREVIOUS RESEARCH block in the prompt.
 */
export function researchPatch(frac: Frac, out: z.infer<typeof researchOutput>, fixed: ResearchFixed = {}): Partial<Frac> {
  const labels = out.postings.map((p) => p.label.trim()).filter(Boolean).slice(0, LIMITS.maxPostings);
  // Kept: postings fixed by a sheet or match, and the team's own when the brief and documents name none
  const keepPostings = frac.postings.length > 0 && (fixed.fixedPostings || !labels.length);
  // Only the postings the brief or documents name; none is fine, the team adds them (review, Nov 2026)
  const postings = keepPostings ? frac.postings : labels.map((label, i) => ({ key: `P${i + 1}`, label }));
  const assumptions = [...out.assumptions, ...out.verify.map((v) => `VERIFY: ${v}`)];
  const sources = fixed.sources?.length ? fixed.sources : out.sources.map(({ url, ...x }) => (url ? { ...x, url } : x));
  const size = SIZES.find((k) => k === out.size.trim().toLowerCase());
  const chosen = frac.sizeBy === "agent" && size ? { size, sizeReason: out.sizeReason.trim() } : {};
  return {
    cadreFull: out.cadreFull.trim() || frac.cadreFull,
    codePrefix: sanitizeCodePrefix(out.codePrefix || frac.cadre),
    postings,
    ...chosen,
    research: {
      ...(fixed.origin ? { origin: fixed.origin } : {}),
      summary: out.summary,
      sourceNotes: out.sourceNotes,
      sources,
      authorised: out.authorised.join("\n"),
      notAuthorised: out.notAuthorised.join("\n"),
      stateContext: out.stateContext.join("\n"),
      assumptions: assumptions.join("\n"),
    },
  };
}

/**
 * Step 2, job research (Kaushal). `input` is what the mock answers from; real providers read only the prompt.
 * Throws AI_OUTPUT_INVALID (via callModel) when an answer has the wrong shape. Without documents, or on revise
 * with feedback, it is one complex-tier call. With documents it reads them first (researchFromDocuments) and
 * researches only what they leave out, with web searches cut to DOCUMENTS.searchesWithDocs. A Sources sheet
 * turns search off. Each source's link is checked before it is kept (source-links.ts linkSources).
 */
export async function runResearch(ctx: StepContext): Promise<Partial<Frac>> {
  const { frac, feedback } = ctx;
  const docs = ctx.documents ?? [];
  const briefDocs = docs.filter((d) => d.kind === "brief").map((d) => ({ name: d.filename, text: d.text }));
  // An uploaded Sources sheet: its rows (kept on the document) replace the model's sources, and search is off
  const sources = frac.uploads?.sources ? (docs.find((d) => d.kind === "sources")?.parsed?.sources ?? null) : null;
  const fixedPostings = !!(frac.seededFrom || frac.uploads?.roles);
  if (briefDocs.length && !feedback) return researchFromDocuments(ctx, briefDocs, sources, fixedPostings);
  let citations: Citation[] = [];
  const searchMaxUses = sources?.length ? 0 : briefDocs.length ? DOCUMENTS.searchesWithDocs : undefined;
  const out = await callModel(ctx, "research", "complex", researchPrompt(frac, feedback, { documents: briefDocs, sources, fixedPostings }),
    { cadre: frac.cadre, state: frac.state, size: frac.size, scope: frac.prompt, feedback, decideSize: frac.sizeBy === "agent", documents: briefDocs.length },
    researchOutput, { searchMaxUses, onCitations: (found) => (citations = found) });
  const linked = sources?.length ? out.sources : await linkSources(out.sources, citations);
  return researchPatch(frac, { ...out, sources: linked.map((x) => ({ ...x, url: x.url ?? "" })) }, { sources, fixedPostings });
}

/**
 * Step 2 with team documents: a default-tier read of the documents (no web search), then the research call for the
 * parts they do not cover, skipped when nothing is left. The documents' text is sent once, to the read; the
 * research call gets what the read found instead.
 */
async function researchFromDocuments(ctx: StepContext, docs: { name: string; text: string }[], sources: FracSource[] | null,
  fixedPostings: boolean): Promise<Partial<Frac>> {
  const { frac } = ctx;
  const decideSize = frac.sizeBy === "agent";
  await ctx.progress(JOB_MESSAGES.researchDocuments);
  const read = await callModel(ctx, "research-documents", "default", documentReadPrompt(frac, docs, fixedPostings),
    { cadre: frac.cadre, state: frac.state, scope: frac.prompt, decideSize, documents: docs.length }, documentReadOutput);
  const split = splitCoverage(read, { sources: !!sources?.length, postings: fixedPostings && frac.postings.length > 0 });
  const todo = [...split.partial, ...split.missing];
  let gap: ResearchOut | null = null;
  if (todo.length) {
    await ctx.progress(JOB_MESSAGES.researchGaps(todo.map((f) => FIELD_LABELS[f]).join(", ")));
    const known = { values: Object.fromEntries([...split.found, ...split.partial].filter((f) => f !== "sources").map((f) => [f, read[f as keyof DocumentRead]])), ...split };
    let citations: Citation[] = [];
    const out = await callModel(ctx, "research", "complex", researchPrompt(frac, undefined, { documents: docs, sources, fixedPostings, known }),
      { cadre: frac.cadre, state: frac.state, size: frac.size, scope: frac.prompt, decideSize, documents: docs.length, gaps: todo },
      researchOutput, { searchMaxUses: sources?.length ? 0 : DOCUMENTS.searchesWithDocs, onCitations: (found) => (citations = found) });
    gap = { ...out, sources: sources?.length ? out.sources : (await linkSources(out.sources, citations)).map((x) => ({ ...x, url: x.url ?? "" })) };
  }
  const merged = mergeResearch(read, gap, split, docs.map((d) => d.name));
  const origin = { documents: [...split.found, ...split.partial].filter((f) => f !== "sources" || !sources?.length), agent: gap ? todo : [] };
  return researchPatch(frac, merged, { sources, fixedPostings, origin });
}
