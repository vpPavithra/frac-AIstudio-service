// Zod request schemas for /v1/fracs, used by routes/frac.routes.ts (validateBody) and
// controllers/frac.controller.ts (parseInput). Array and text caps come from LIMITS in config/constants.ts.
import { z } from "zod";
import { LIMITS } from "../config/constants.ts";

// Request shapes for the Creator API (spec 4.1). Every field a handler uses is declared here;
// validateBody drops anything else.

/** Long free text, capped by MAX_TEXT_CHARS; missing becomes "". */
const text = () => z.string().max(LIMITS.maxTextChars).default("");
/** `required` is the message for both a missing field and an empty one, so the person sees one sentence. */
const shortText = (max = 200, required?: string) => {
  const base = z.string(required ? { required_error: required } : undefined).trim().max(max);
  return required ? base.min(1, required) : base;
};

/** Brief sizes the portal offers. config/frac-sizes.json must define every one (config/frac-sizes.ts). */
export const FRAC_SIZES = ["compact", "standard", "full"] as const;
/** The state stored when the brief names none. */
export const NATIONAL_BASELINE = "India (national baseline)";

const levelSchema = z.object({ label: text(), desc: text() });

const postingSchema = z.object({ key: shortText(20).min(1), label: text() });

/**
 * A source link. Any text is accepted, because autosave sends it while it is being typed; the portal turns
 * only http(s) addresses into a "View source" link.
 */
const sourceUrl = z.string().trim().max(2000).optional();

const sourceSchema = z.object({ title: text(), issuer: text(), year: text(), use: text(), tier: text(), url: sourceUrl });

const researchField = z.enum(["cadreFull", "summary", "postings", "authorised", "notAuthorised", "stateContext", "sources"]);

const researchSchema = z.object({
  summary: text(),
  sourceNotes: text(),
  sources: z.array(sourceSchema).max(100).default([]),
  authorised: text(),
  notAuthorised: text(),
  stateContext: text(),
  assumptions: text(),
  // Set by research; the portal sends it back unchanged with the team's edits
  origin: z.object({ documents: z.array(researchField).max(10), agent: z.array(researchField).max(10) }).optional(),
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

/**
 * Position matching: start from the owner's earlier FRAC (copied by the service after its owner check), or
 * from a FRAC module position whose roles and activities the portal read from the Positions master.
 */
const seedSchema = z.discriminatedUnion("from", [
  // withRoles false copies the postings only (the portal leaves the roles unticked by default)
  z.object({ from: z.literal("frac"), fracId: z.string().uuid("fracId must be a FRAC id"), withRoles: z.boolean().default(true) }),
  z.object({
    from: z.literal("positions"),
    code: shortText(100, "Position code is required"),
    name: shortText(200, "Position name is required"),
    roles: z
      .array(z.object({ title: shortText(500).min(1), activities: z.array(z.string().trim().min(1).max(LIMITS.maxTextChars)).max(LIMITS.maxActivitiesPerRole).default([]) }))
      .min(1, "The matched position has no roles")
      .max(LIMITS.maxRoles),
  }),
]);
export type FracSeedInput = z.infer<typeof seedSchema>;

/**
 * POST /fracs: the brief (spec 5.1). `size` is no longer asked: without it the research step chooses one
 * (sizeBy "agent"). `seed` copies a matched position's postings and roles.
 */
export const createFracSchema = z.object({
  cadre: shortText(200, "Position is required"),
  state: shortText().optional().transform((s) => s || NATIONAL_BASELINE),
  size: z.enum(FRAC_SIZES).optional(),
  prompt: text(),
  seed: seedSchema.optional(),
});
export type CreateFracInput = z.infer<typeof createFracSchema>;

/**
 * PATCH /fracs/:id: team edits. Every field optional. `rolesDirty` may only be cleared
 * (the team confirms mappings by hand); the server alone sets it. `checked` marks a step checked.
 */
export const patchFracSchema = z.object({
  cadre: shortText().min(1).optional(),
  state: shortText().min(1).optional(),
  size: z.enum(FRAC_SIZES).optional(),
  prompt: z.string().max(LIMITS.maxTextChars).optional(),
  cadreFull: shortText().optional(),
  codePrefix: shortText(20).optional(),
  postings: z.array(postingSchema).max(LIMITS.maxPostings).optional(),
  research: researchSchema.nullable().optional(),
  roles: z.array(roleSchema).max(LIMITS.maxRoles).optional(),
  competencies: z.array(competencySchema).max(LIMITS.maxCompetencies).optional(),
  rolesDirty: z.literal(false, { errorMap: () => ({ message: "rolesDirty can only be set to false" }) }).optional(),
  /** Steps the team checked after an earlier one changed: they are no longer out of date. */
  checked: z.array(z.enum(["research", "roles", "competencies", "ladders"])).max(4).optional(),
  /** Removes roles copied from a matched position, so the roles step builds them from the research. */
  clearCopiedRoles: z.literal(true).optional(),
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

/** POST /fracs/:id/fixes/outdated: the finding title, "Outdated reference: …". */
export const outdatedFixSchema = z.object({ title: shortText(300, "Finding title is required") });
export type OutdatedFixInput = z.infer<typeof outdatedFixSchema>;

/** GET /fracs/match: the position typed on the brief, and its state to rank same-state FRACs first. */
export const matchQuerySchema = z.object({
  cadre: shortText(200, "Position is required"),
  state: shortText().optional(),
});
export type MatchQuery = z.infer<typeof matchQuerySchema>;

/** :versionId in POST /fracs/:id/versions/:versionId/restore. */
export const versionIdSchema = z.coerce.number({ invalid_type_error: "versionId must be a number" }).int().positive();

/** Kinds of document a FRAC accepts: a brief document (JD or order) for research, or a standard sheet. */
export const DOCUMENT_KINDS = ["brief", "roles", "competencies", "sources"] as const;

/** POST /fracs/:id/documents form field, and :kind in GET /templates/:kind. */
export const documentKindSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS, { errorMap: () => ({ message: "kind must be brief, roles, competencies or sources" }) }),
});
export type DocumentKindInput = z.infer<typeof documentKindSchema>;
