// FRAC SERVICE: the Creator (spec 5) and My FRACs. Creates, reads, edits, versions and exports FRACs, and
// starts each AI step as a job: brief -> research -> roles & activities -> competencies -> ladders -> expert
// check. Each step function (services/ai/*.step.ts) calls the TextProvider, validates the JSON with Zod and
// records usage/cost; this file checks the step may run (STEP_NOT_READY), merges the result into the latest
// saved FRAC, logs it and snapshots a version. Called by controllers/frac.controller.ts; wired in server.ts.
import { randomUUID } from "node:crypto";
import { fracToModel } from "./review-engine/convert.ts";
import type { Frac, FracVersion } from "../models/frac.model.ts";
import { buildFracWorkbook, fracWorkbookFilename } from "./excel/workbook-writer.ts";
import type { JobRunner } from "./queue/job-runner.ts";
import { EXPERT_CHECK_NOTES, JOB_MESSAGES } from "./queue/job-messages.ts";
import type { Repositories } from "../repositories/index.ts";
import type { TextProvider } from "../providers/text/types.ts";
import { sanitizeCodePrefix } from "../utils/codes.ts";
import { badRequest, conflict, notFound } from "../utils/response.ts";
import type { CreateFracInput, PatchFracInput, StepInput } from "../validations/frac.schema.ts";
import { runCompetencies } from "./ai/competencies.step.ts";
import { runLadders } from "./ai/ladders.step.ts";
import { runResearch } from "./ai/research.step.ts";
import { runRoles } from "./ai/roles.step.ts";
import type { StepContext } from "./ai/step-context.ts";
import { type ReviewService, worstSeverity } from "./review.service.ts";

/** One row of My FRACs (GET /v1/fracs). `worst` is the most severe open review finding, if any. */
export interface FracSummary {
  id: string;
  cadre: string;
  state: string;
  step: number;
  imported: string | null;
  counts: { roles: number; activities: number; competencies: number };
  worst: "B" | "M" | "m" | null;
  updatedAt: string;
}

/** Brief fields (spec 5.1) that lock once research exists. */
const BRIEF_FIELDS = ["cadre", "state", "size", "prompt"] as const;

/**
 * A new FRAC at step 1 (brief only). cadreFull starts as the cadre and codePrefix as "C" until research
 * sets them. `id` and `now` are parameters so tests can fix them.
 */
export function newFrac(ownerId: string, brief: CreateFracInput, id = randomUUID(), now = new Date()): Frac {
  const at = now.toISOString();
  return {
    id,
    createdAt: at,
    updatedAt: at,
    ownerId,
    step: 1,
    cadre: brief.cadre,
    cadreFull: brief.cadre,
    state: brief.state,
    size: brief.size,
    prompt: brief.prompt,
    codePrefix: "C",
    postings: [],
    research: null,
    roles: [],
    competencies: [],
    rolesDirty: false,
    review: null,
    log: [],
  };
}

/**
 * Applies validated team edits (spec 8, PATCH). The brief locks once research exists (5.1; 409 BRIEF_LOCKED);
 * editing roles after competencies exist sets rolesDirty (5.3); the team may clear it. codePrefix is sanitised.
 * Pure: the caller saves the result.
 */
export function applyEdits(frac: Frac, edits: PatchFracInput, now = new Date()): Frac {
  const changesBrief = BRIEF_FIELDS.some((k) => edits[k] !== undefined && edits[k] !== frac[k]);
  if (changesBrief && frac.research) throw conflict("BRIEF_LOCKED", "The brief is locked once research exists");

  const { codePrefix, roles, rolesDirty, ...rest } = edits;
  const next: Frac = { ...frac, ...rest, updatedAt: now.toISOString() };
  if (codePrefix !== undefined) next.codePrefix = sanitizeCodePrefix(codePrefix);
  if (roles) {
    const changed = JSON.stringify(roles) !== JSON.stringify(frac.roles);
    next.roles = roles;
    if (changed && next.competencies.length) next.rolesDirty = true;
  } else if (rolesDirty === false) {
    next.rolesDirty = false;
  }
  return next;
}

/** The My FRACs row for a FRAC: counts and the worst finding, without the full content. */
export function summarise(f: Frac): FracSummary {
  return {
    id: f.id,
    cadre: f.cadre,
    state: f.state,
    step: f.step,
    imported: f.imported ?? null,
    counts: {
      roles: f.roles.length,
      activities: f.roles.reduce((n, r) => n + r.activities.length, 0),
      competencies: f.competencies.length,
    },
    worst: worstSeverity(f.review),
    updatedAt: f.updatedAt,
  };
}

/** The AI steps started through POST /v1/fracs/:id/steps/:step; the expert check has its own route. */
export type GenerationStep = "research" | "roles" | "competencies" | "ladders";

interface StepSpec {
  number: number;
  label: string;
  msg: string;
  run: (ctx: StepContext) => Promise<Partial<Frac>>;
  /** Why the step cannot run yet, or null. */
  notReady: (f: Frac) => string | null;
}

/**
 * Step number (spec 5), job message, the step function and what must exist before it runs.
 * An imported FRAC (opened from a review) has roles but no research, so roles accepts `imported` too.
 */
const STEPS: Record<GenerationStep, StepSpec> = {
  research: { number: 2, label: "Job research", msg: JOB_MESSAGES.research, run: runResearch, notReady: () => null },
  roles: {
    number: 3, label: "Roles & activities", msg: JOB_MESSAGES.roles, run: runRoles,
    notReady: (f) => (f.research || f.imported ? null : "Run job research before building roles"),
  },
  competencies: {
    number: 4, label: "Competencies", msg: JOB_MESSAGES.competencies, run: runCompetencies,
    notReady: (f) => (f.roles.some((r) => r.activities.length) ? null : "Build roles and activities before deriving competencies"),
  },
  ladders: {
    number: 5, label: "Level ladders", msg: JOB_MESSAGES.ladders(0), run: runLadders,
    notReady: (f) => (f.competencies.length ? null : "Derive competencies before writing ladders"),
  },
};

/**
 * Creator tab (spec 5) and My FRACs. Every read goes through `get`, which scopes to the owner and answers
 * 404 for someone else's FRAC, so no other method checks ownership itself.
 */
export class FracService {
  constructor(
    private readonly repos: Repositories,
    private readonly runner: JobRunner,
    private readonly reviews: ReviewService,
    private readonly methodParagraph: () => string,
    private readonly provider: TextProvider,
  ) {}

  /**
   * Runs one generation step as a job (spec 5.2–5.5). The step reads the FRAC as it was when the job
   * started; its result is merged into the latest saved FRAC, so edits made meanwhile are kept. Then
   * the step and its feedback are logged and a version is snapshotted, so a bad revise can be undone.
   * Throws 409 STEP_NOT_READY (before any job starts) when an earlier step is missing. Returns the queued job;
   * step errors (AI_OUTPUT_INVALID, AI_* from the provider) end up on the job, not here.
   */
  async startStep(ownerId: string, id: string, step: GenerationStep, body: StepInput) {
    const frac = await this.get(ownerId, id);
    const spec = STEPS[step];
    const reason = spec.notReady(frac);
    if (reason) throw conflict("STEP_NOT_READY", reason);

    return this.runner.start({ ownerId, kind: step, targetId: id, msg: spec.msg }, async (progress, recordUsage) => {
      // Re-reads before each write so team edits saved during the job are kept (ladders save per batch)
      const save = async (update: (latest: Frac) => Partial<Frac>) => {
        const latest = await this.get(ownerId, id);
        const next: Frac = { ...latest, ...update(latest), updatedAt: new Date().toISOString() };
        await this.repos.fracs.update(next);
        return next;
      };
      const patch = await spec.run({ frac, feedback: body.feedback, codes: body.codes, provider: this.provider, progress, recordUsage, save });
      const done = await save((latest) => ({
        ...patch,
        step: Math.max(latest.step, spec.number),
        log: [...latest.log, { at: new Date().toISOString(), step: spec.number, feedback: body.feedback ?? "" }],
      }));
      await this.repos.fracs.snapshot(done, body.feedback ? `${spec.label} (revised)` : spec.label);
    });
  }

  /** Step 1: saves a new FRAC from the brief. */
  async create(ownerId: string, brief: CreateFracInput): Promise<Frac> {
    const frac = newFrac(ownerId, brief);
    await this.repos.fracs.insert(frac);
    return frac;
  }

  /** The FRAC if this owner has it; 404 NOT_FOUND otherwise, so other owners' ids are not revealed. */
  async get(ownerId: string, id: string): Promise<Frac> {
    const frac = await this.repos.fracs.get(id);
    if (!frac || frac.ownerId !== ownerId) throw notFound("FRAC");
    return frac;
  }

  async list(ownerId: string): Promise<FracSummary[]> {
    return (await this.repos.fracs.listByOwner(ownerId)).map(summarise);
  }

  /** Saves team edits (autosave). Not versioned; versions are taken by steps, the check and restore. */
  async patch(ownerId: string, id: string, edits: PatchFracInput): Promise<Frac> {
    const next = applyEdits(await this.get(ownerId, id), edits);
    await this.repos.fracs.update(next);
    return next;
  }

  /**
   * Step 6 expert check: the Reviewer engine on fracToModel (spec 5.6), with the fixed EXPERT_CHECK_NOTES.
   * Saves the report on the FRAC, snapshots it, and stores it as a review of kind "expert-check" (gap 10).
   * Throws 400 NO_COMPETENCIES before any job starts. The check reviews the FRAC as it was when it started.
   */
  async startCheck(ownerId: string, id: string) {
    const frac = await this.get(ownerId, id);
    if (!frac.competencies.length) {
      throw badRequest("NO_COMPETENCIES", "Derive competencies before running the expert check");
    }

    return this.runner.start({ ownerId, kind: "check", targetId: id, msg: JOB_MESSAGES.check }, async (_progress, recordUsage) => {
      const model = fracToModel(frac);
      const report = await this.reviews.review(model, { cadre: frac.cadre, state: frac.state, notes: EXPERT_CHECK_NOTES }, recordUsage);
      // Re-read so edits saved while the check ran are kept
      const latest = await this.get(ownerId, id);
      const checked: Frac = { ...latest, review: report, step: 6, updatedAt: new Date().toISOString() };
      await this.repos.fracs.update(checked);
      await this.repos.fracs.snapshot(checked, "Expert check");
      await this.reviews.recordExpertCheck(ownerId, checked, model, report);
    });
  }

  /** Saved snapshots of a FRAC, after the owner check. */
  async versions(ownerId: string, id: string): Promise<FracVersion[]> {
    await this.get(ownerId, id);
    return this.repos.fracs.versions(id);
  }

  /** Rolls back to a snapshot, after snapshotting the current state so the restore is undoable. */
  async restore(ownerId: string, id: string, versionId: number): Promise<Frac> {
    const current = await this.get(ownerId, id);
    const old = await this.repos.fracs.version(id, versionId);
    if (!old) throw notFound("Version");
    await this.repos.fracs.snapshot(current, "Before restore");
    const restored: Frac = { ...old, id, ownerId, updatedAt: new Date().toISOString() };
    await this.repos.fracs.update(restored);
    return restored;
  }

  /** The FRAC as an Excel workbook (spec 7), with the method paragraph from config (METHOD_PARAGRAPH_PATH). */
  async exportWorkbook(ownerId: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const frac = await this.get(ownerId, id);
    return { buffer: await buildFracWorkbook(frac, this.methodParagraph()), filename: fracWorkbookFilename(frac) };
  }
}
