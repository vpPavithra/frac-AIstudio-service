import { z } from "zod";

// Model output shapes from spec 5.2–5.5 and 6.4. A provider's JSON is parsed with these before any
// step uses it, so a malformed answer fails the job with AI_OUTPUT_INVALID instead of corrupting a FRAC.

const s = () => z.string().default("");
const lines = () => z.array(z.string()).default([]);

export const researchOutput = z.object({
  cadreFull: s(),
  codePrefix: s(),
  summary: s(),
  postings: z.array(z.object({ key: s(), label: s() })).default([]),
  sources: z.array(z.object({ title: s(), issuer: s(), year: s(), use: s(), tier: s() })).default([]),
  authorised: lines(),
  notAuthorised: lines(),
  stateContext: lines(),
  sourceNotes: s(),
  assumptions: lines(),
  verify: lines(),
});

export const rolesOutput = z.object({ roles: z.array(z.object({ title: z.string().min(1), source: s() })).min(1) });

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

export const competenciesOutput = z.object({
  competencies: z
    .array(z.object({ code: z.string().min(1), label: z.string().min(1), description: s(), type: s(), area: s(), kcm: s() }))
    .min(1),
  mapping: z.array(z.object({ a: z.string(), c: z.string(), l: z.coerce.number().int().min(1).max(5) })),
});

export const laddersOutput = z.object({
  ladders: z.array(z.object({ code: z.string(), levels: z.array(z.object({ label: s(), desc: s() })).length(5) })),
});

// Rules r3 §6: the Reviewer's fixed checklist. Answers carry quotes that code verifies against the file.
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

export const reviewStateOutput = z.object({
  items: z.array(z.object({ category: s(), item: s(), refs: z.array(z.string()).default([]) })).default([]),
});
