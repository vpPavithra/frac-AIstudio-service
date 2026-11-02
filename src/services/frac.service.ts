import { randomUUID } from "node:crypto";
import { fracToModel } from "./review-engine/convert.js";
import type { Frac, FracVersion } from "../models/frac.model.js";
import { buildFracWorkbook, fracWorkbookFilename } from "./excel/workbook-writer.js";
import type { JobRunner } from "./queue/job-runner.js";
import { EXPERT_CHECK_NOTES, JOB_MESSAGES } from "./queue/job-messages.js";
import type { Repositories } from "../repositories/index.js";
import { badRequest, conflict, notFound } from "../utils/response.js";
import type { CreateFracInput, PatchFracInput } from "../validations/frac.schema.js";
import { type ReviewService, worstSeverity } from "./review.service.js";

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

const BRIEF_FIELDS = ["cadre", "state", "size", "prompt"] as const;

/** A–Z only, at most 4 characters, fallback "C" (spec 4.1). */
export function sanitizeCodePrefix(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) || "C";
}

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
 * Applies validated team edits (spec 8, PATCH). The brief locks once research exists (5.1);
 * editing roles after competencies exist sets rolesDirty (5.3); the team may clear it.
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

/** Creator tab (spec 5) and My FRACs. The generation steps (2–5) arrive with the LLM layer. */
export class FracService {
  constructor(
    private readonly repos: Repositories,
    private readonly runner: JobRunner,
    private readonly reviews: ReviewService,
    private readonly methodParagraph: () => string,
  ) {}

  async create(ownerId: string, brief: CreateFracInput): Promise<Frac> {
    const frac = newFrac(ownerId, brief);
    await this.repos.fracs.insert(frac);
    return frac;
  }

  async get(ownerId: string, id: string): Promise<Frac> {
    const frac = await this.repos.fracs.get(id);
    if (!frac || frac.ownerId !== ownerId) throw notFound("FRAC");
    return frac;
  }

  async list(ownerId: string): Promise<FracSummary[]> {
    return (await this.repos.fracs.listByOwner(ownerId)).map(summarise);
  }

  async patch(ownerId: string, id: string, edits: PatchFracInput): Promise<Frac> {
    const next = applyEdits(await this.get(ownerId, id), edits);
    await this.repos.fracs.update(next);
    return next;
  }

  /** Step 6 expert check: the Reviewer engine on fracToModel (spec 5.6). */
  async startCheck(ownerId: string, id: string) {
    const frac = await this.get(ownerId, id);
    if (!frac.competencies.length) {
      throw badRequest("NO_COMPETENCIES", "Derive competencies before running the expert check");
    }

    return this.runner.start({ ownerId, kind: "check", targetId: id, msg: JOB_MESSAGES.check }, async () => {
      const model = fracToModel(frac);
      const report = await this.reviews.review(model, { cadre: frac.cadre, state: frac.state, notes: EXPERT_CHECK_NOTES });
      // Re-read so edits saved while the check ran are kept
      const latest = await this.get(ownerId, id);
      const checked: Frac = { ...latest, review: report, step: 6, updatedAt: new Date().toISOString() };
      await this.repos.fracs.update(checked);
      await this.repos.fracs.snapshot(checked, "Expert check");
      await this.reviews.recordExpertCheck(ownerId, checked, model, report);
    });
  }

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

  async exportWorkbook(ownerId: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const frac = await this.get(ownerId, id);
    return { buffer: await buildFracWorkbook(frac, this.methodParagraph()), filename: fracWorkbookFilename(frac) };
  }
}
