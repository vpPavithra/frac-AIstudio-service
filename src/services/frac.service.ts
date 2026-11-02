import { randomUUID } from "node:crypto";
import { fracToModel } from "../engine/convert.js";
import type { Frac, FracSize } from "../engine/types.js";
import { buildFracWorkbook, fracWorkbookFilename } from "../io/workbook-writer.js";
import type { JobRunner } from "../jobs/job-runner.js";
import { EXPERT_CHECK_NOTES, JOB_MESSAGES } from "../jobs/messages.js";
import { badRequest, notFound } from "../middleware/errors.js";
import type { FracVersion, Repositories } from "../repositories/types.js";
import { type ReviewService, worstSeverity } from "./review.service.js";

const SIZES: readonly FracSize[] = ["compact", "standard", "full"];
const MAX_TEXT = 20_000;

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

export interface Brief {
  cadre: string;
  state: string;
  size: FracSize;
  prompt: string;
}

type Body = Record<string, unknown>;

function text(body: Body, key: string, required = false): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${key} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw badRequest(`${key} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) throw badRequest(`${key} is required`);
  if (trimmed.length > MAX_TEXT) throw badRequest(`${key} is too long`);
  return trimmed;
}

function size(body: Body): FracSize | undefined {
  const value = body.size;
  if (value === undefined) return undefined;
  if (!SIZES.includes(value as FracSize)) throw badRequest(`size must be one of ${SIZES.join(", ")}`);
  return value as FracSize;
}

/** Spec 5.1. State defaults to the national baseline. */
export function parseBrief(body: Body): Brief {
  return {
    cadre: text(body, "cadre", true) as string,
    state: text(body, "state") || "India (national baseline)",
    size: size(body) ?? "standard",
    prompt: text(body, "prompt") ?? "",
  };
}

/** A–Z only, at most 4 characters, fallback "C" (spec 4.1). */
export function sanitizeCodePrefix(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) || "C";
}

export function newFrac(ownerId: string, brief: Brief, id = randomUUID(), now = new Date()): Frac {
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

function array(body: Body, key: string): unknown[] | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw badRequest(`${key} must be a list`);
  return value;
}

/**
 * Applies team edits (spec 8, PATCH). The brief locks once research exists (5.1); editing roles
 * after competencies exist sets rolesDirty (5.3). Shapes inside roles/competencies/research are
 * the UI's to keep; this only guards the top-level types.
 */
export function applyEdits(frac: Frac, body: Body, now = new Date()): Frac {
  const next: Frac = { ...frac };
  const briefKeys = (["cadre", "state", "size", "prompt"] as const).filter(
    (k) => body[k] !== undefined && body[k] !== frac[k],
  );
  if (briefKeys.length && frac.research) throw badRequest("The brief is locked once research exists");

  next.cadre = text(body, "cadre") || frac.cadre;
  next.state = text(body, "state") || frac.state;
  next.size = size(body) ?? frac.size;
  next.prompt = text(body, "prompt") ?? frac.prompt;
  next.cadreFull = text(body, "cadreFull") || frac.cadreFull;
  const prefix = text(body, "codePrefix");
  if (prefix !== undefined) next.codePrefix = sanitizeCodePrefix(prefix);

  const postings = array(body, "postings");
  if (postings) next.postings = postings as Frac["postings"];
  const competencies = array(body, "competencies");
  if (competencies) next.competencies = competencies as Frac["competencies"];
  if (body.research !== undefined) {
    if (body.research !== null && typeof body.research !== "object") throw badRequest("research must be an object");
    next.research = body.research as Frac["research"];
  }
  const roles = array(body, "roles");
  if (roles) {
    const changed = JSON.stringify(roles) !== JSON.stringify(frac.roles);
    next.roles = roles as Frac["roles"];
    if (changed && next.competencies.length) next.rolesDirty = true;
  }
  // The team may confirm the mapping by hand; only the server ever sets it back to true
  if (body.rolesDirty === false && !roles) next.rolesDirty = false;

  next.updatedAt = now.toISOString();
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

  async create(ownerId: string, body: Body): Promise<Frac> {
    const frac = newFrac(ownerId, parseBrief(body));
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

  async patch(ownerId: string, id: string, body: Body): Promise<Frac> {
    const next = applyEdits(await this.get(ownerId, id), body);
    await this.repos.fracs.update(next);
    return next;
  }

  /** Step 6 expert check: the Reviewer engine on fracToModel (spec 5.6). */
  async startCheck(ownerId: string, id: string) {
    const frac = await this.get(ownerId, id);
    if (!frac.competencies.length) throw badRequest("Derive competencies before running the expert check");

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
