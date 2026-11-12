// OUTPUT SCHEMAS (Zod) for every AI call. step-context.ts callModel (Creator steps) and ai-review.service.ts
// (Reviewer) parse the provider's JSON with these. The shapes must match the JSON examples in prompts.ts.
// The Zod 4 API (shipped inside zod 3.25 as "zod/v4"): the Anthropic SDK turns these into JSON schemas for
// Claude structured output (providers/text/claude.ts). Request validation (validations/) stays on the zod 3 API.
import { z } from "zod/v4";

// Model output shapes from spec 5.2–5.5 and 6.4. A provider's JSON is parsed with these before any
// step uses it, so a malformed answer fails the job with AI_OUTPUT_INVALID instead of corrupting a FRAC.

// Optional text and lists default to empty, so a missing field is tolerated; the required ones use min(1)
const s = () => z.string().default("");
const lines = () => z.array(z.string()).default([]);

/** Step 2 (spec 5.2). Every field is optional; researchPatch fills the gaps. */
export const researchOutput = z.object({
  cadreFull: s(),
  codePrefix: s(),
  summary: s(),
  postings: z.array(z.object({ key: s(), label: s() })).default([]),
  sources: z.array(z.object({ title: s(), issuer: s(), year: s(), use: s(), tier: s(), url: s() })).default([]),
  authorised: lines(),
  notAuthorised: lines(),
  stateContext: lines(),
  sourceNotes: s(),
  assumptions: lines(),
  verify: lines(),
  /** Only asked when the agent chooses the size (sizeBy "agent"): compact, standard or full, and why. */
  size: s(),
  sizeReason: s(),
});

/** How much of a research field the team's documents cover. */
const coverage = () => z.enum(["found", "partial", "missing"]).default("missing");

/**
 * Step 2, first part when the team attached documents: what the documents say, field by field, and how much of
 * each they cover. No sources: the documents themselves are the sources (research.step.ts documentSources).
 */
export const documentReadOutput = researchOutput.omit({ sources: true }).extend({
  coverage: z.object({
    cadreFull: coverage(),
    summary: coverage(),
    postings: coverage(),
    authorised: coverage(),
    notAuthorised: coverage(),
    stateContext: coverage(),
  }).default({ cadreFull: "missing", summary: "missing", postings: "missing", authorised: "missing", notAuthorised: "missing", stateContext: "missing" }),
});

/** Step 3a: at least one role, each with a title. Codes are assigned in code, not by the model. */
export const rolesOutput = z.object({ roles: z.array(z.object({ title: z.string().min(1), source: s() })).min(1) });

/** Step 3b: activities per role code; `postings` maps a posting key to "Yes"/"No". */
export const activitiesOutput = z.object({
  roles: z.array(
    z.object({
      code: z.string(),
      activities: z.array(
        z.object({ text: z.string().min(1), postings: z.record(z.string(), z.string()).default({}), source: s(), tier: s() }),
      ),
    }),
  ),
});

/** Step 4: competencies plus the activity -> competency@level mapping (`l` is 1-5; numeric strings are coerced). */
export const competenciesOutput = z.object({
  competencies: z
    .array(z.object({ code: z.string().min(1), label: z.string().min(1), description: s(), type: s(), area: s(), kcm: s() }))
    .min(1),
  mapping: z.array(z.object({ a: z.string(), c: z.string(), l: z.coerce.number().int().min(1).max(5) })),
});

/** Step 4 with a team's Competencies sheet: only the activity -> competency@level mapping, to the given codes. */
export const mappingOutput = z.object({
  mapping: z.array(z.object({ a: z.string(), c: z.string(), l: z.coerce.number().int().min(1).max(5) })),
});

/** Step 5: exactly five levels (L1-L5) per ladder; any other count fails with AI_OUTPUT_INVALID. */
export const laddersOutput = z.object({
  ladders: z.array(z.object({ code: z.string(), levels: z.array(z.object({ label: s(), desc: s() })).length(5) })),
});

// Rules r3 §6: the Reviewer's fixed checklist. Answers carry quotes that code verifies against the file.
/** Q1 scope and Q2 accuracy flags per competency (rules r3 §6.1). An empty list is a valid answer. */
export const reviewChecklistOutput = z.object({
  items: z
    .array(
      z.object({
        code: z.string(),
        scope: z.array(z.object({ quote: s(), act: s(), basis: s() })).default([]),
        accuracy: z.array(z.object({ quote: s(), issue: s(), correct: s() })).default([]),
      }),
    )
    .default([]),
});

/** Q3 state-fit items (rules r3 §6.2). */
export const reviewStateOutput = z.object({
  items: z.array(z.object({ category: s(), item: s(), refs: z.array(z.string()).default([]) })).default([]),
});
