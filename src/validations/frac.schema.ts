import { z } from "zod";
import { LIMITS } from "../config/constants.ts";

// Request shapes for the Creator API (spec 4.1). Every field a handler uses is declared here;
// validateBody drops anything else.

const text = () => z.string().max(LIMITS.maxTextChars).default("");
/** `required` is the message for both a missing field and an empty one, so the person sees one sentence. */
const shortText = (max = 200, required?: string) => {
  const base = z.string(required ? { required_error: required } : undefined).trim().max(max);
  return required ? base.min(1, required) : base;
};

export const FRAC_SIZES = ["compact", "standard", "full"] as const;
export const NATIONAL_BASELINE = "India (national baseline)";

const levelSchema = z.object({ label: text(), desc: text() });

const postingSchema = z.object({ key: shortText(20).min(1), label: text() });

const sourceSchema = z.object({ title: text(), issuer: text(), year: text(), use: text(), tier: text() });

const researchSchema = z.object({
  summary: text(),
  sourceNotes: text(),
  sources: z.array(sourceSchema).max(100).default([]),
  authorised: text(),
  notAuthorised: text(),
  stateContext: text(),
  assumptions: text(),
});

const activitySchema = z.object({
  code: shortText(20).default(""),
  text: text(),
  postings: z.record(z.string(), z.string().max(20)).default({}),
  source: text(),
  tier: text(),
  comp: text(),
});

const roleSchema = z.object({
  code: shortText(20).default(""),
  title: text(),
  source: text(),
  activities: z.array(activitySchema).max(LIMITS.maxActivitiesPerRole).default([]),
});

const competencySchema = z.object({
  code: shortText(20, "Competency code is required"),
  label: text(),
  description: text(),
  type: text(),
  area: text(),
  kcm: text(),
  levels: z.array(levelSchema).max(5).nullable().default(null),
});

/** POST /fracs: the brief (spec 5.1). */
export const createFracSchema = z.object({
  cadre: shortText(200, "Cadre is required"),
  state: shortText().optional().transform((s) => s || NATIONAL_BASELINE),
  size: z.enum(FRAC_SIZES).default("standard"),
  prompt: text(),
});
export type CreateFracInput = z.infer<typeof createFracSchema>;

/**
 * PATCH /fracs/:id: team edits. Every field optional. `rolesDirty` may only be cleared
 * (the team confirms mappings by hand); the server alone sets it.
 */
export const patchFracSchema = z.object({
  cadre: shortText().min(1).optional(),
  state: shortText().min(1).optional(),
  size: z.enum(FRAC_SIZES).optional(),
  prompt: z.string().max(LIMITS.maxTextChars).optional(),
  cadreFull: shortText().optional(),
  codePrefix: shortText(20).optional(),
  postings: z.array(postingSchema).max(3).optional(),
  research: researchSchema.nullable().optional(),
  roles: z.array(roleSchema).max(LIMITS.maxRoles).optional(),
  competencies: z.array(competencySchema).max(LIMITS.maxCompetencies).optional(),
  rolesDirty: z.literal(false, { errorMap: () => ({ message: "rolesDirty can only be set to false" }) }).optional(),
});
export type PatchFracInput = z.infer<typeof patchFracSchema>;

/**
 * POST /fracs/:id/steps/:step (spec 8): optional team feedback for a revise; ladders also take the
 * competency codes to rewrite ("Revise {code}", "Fix these competencies").
 */
export const stepSchema = z.object({
  feedback: z.string().trim().max(5000).optional().transform((s) => s || undefined),
  codes: z.array(shortText(20, "Competency code is required")).max(LIMITS.maxCompetencies).optional(),
});
export type StepInput = z.infer<typeof stepSchema>;

/** :versionId in POST /fracs/:id/versions/:versionId/restore. */
export const versionIdSchema = z.coerce.number({ invalid_type_error: "versionId must be a number" }).int().positive();
