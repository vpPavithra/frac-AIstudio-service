// HTTP handlers for /v1/fracs: read params and the owner, call FracService, shape the response.
// No rules live here. Steps and checks answer 202 { jobId }; the portal then polls GET /v1/jobs/:id.
import type { Request, Response } from "express";
import { parseInput } from "../middleware/validate.ts";
import { ownerOf } from "../middleware/auth.ts";
import type { FracService, GenerationStep } from "../services/frac.service.ts";
import { notFound } from "../utils/response.ts";
import {
  matchQuerySchema,
  versionIdSchema,
  type CreateFracInput,
  type OutdatedFixInput,
  type PatchFracInput,
  type StepInput,
} from "../validations/frac.schema.ts";
import { param, sendXlsx } from "./http.ts";

/** Generation steps 2–5 (spec 5.2–5.5); step 6 is /steps/check. */
const GENERATION_STEPS = new Set<string>(["research", "roles", "competencies", "ladders"]);

/** HTTP handlers for the Creator (spec 8, /fracs). Bodies arrive validated by the routes. */
export function fracController(fracs: FracService) {
  return {
    async create(req: Request, res: Response) {
      const frac = await fracs.create(ownerOf(res), req.body as CreateFracInput);
      res.status(201).json({ id: frac.id, frac });
    },

    async list(_req: Request, res: Response) {
      res.json({ fracs: await fracs.list(ownerOf(res)) });
    },

    /** Position matching: ?cadre=&state=; `match` is null when the owner has no FRAC for that position. */
    async match(req: Request, res: Response) {
      res.json({ match: await fracs.match(ownerOf(res), parseInput(matchQuerySchema, req.query)) });
    },

    /** `activeJobId`: the step or check still running on it, so a reloaded page can show its progress. */
    async get(req: Request, res: Response) {
      const id = param(req.params.id);
      const [frac, activeJobId] = await Promise.all([fracs.get(ownerOf(res), id), fracs.activeJobId(ownerOf(res), id)]);
      res.json({ frac, activeJobId });
    },

    async patch(req: Request, res: Response) {
      res.json({ frac: await fracs.patch(ownerOf(res), param(req.params.id), req.body as PatchFracInput) });
    },

    /** Quick checks while the FRAC is built: Bloom's verbs and FRAC structure, rule-based, each tagged with its tab. */
    async ruleChecks(req: Request, res: Response) {
      res.json({ checks: await fracs.ruleChecks(ownerOf(res), param(req.params.id)) });
    },

    /** "Replace with …" on an outdated-name finding; body { title }. Answers { frac, replaced }. */
    async replaceOutdated(req: Request, res: Response) {
      const { title } = req.body as OutdatedFixInput;
      res.json(await fracs.replaceOutdated(ownerOf(res), param(req.params.id), title));
    },

    async startCheck(req: Request, res: Response) {
      const job = await fracs.startCheck(ownerOf(res), param(req.params.id));
      res.status(202).json({ jobId: job.id });
    },

    /** The agent checks the roles and activities against the documents and the research; nothing is changed. */
    async startRolesVerify(req: Request, res: Response) {
      const job = await fracs.startRolesVerify(ownerOf(res), param(req.params.id));
      res.status(202).json({ jobId: job.id });
    },

    /** Steps 2–5: start the generation job; body { feedback?, codes? } (codes for ladders only). */
    async startStep(req: Request, res: Response) {
      const step = param(req.params.step);
      if (!GENERATION_STEPS.has(step)) throw notFound("Step");
      const job = await fracs.startStep(ownerOf(res), param(req.params.id), step as GenerationStep, req.body as StepInput);
      res.status(202).json({ jobId: job.id });
    },

    async exportWorkbook(req: Request, res: Response) {
      sendXlsx(res, await fracs.exportWorkbook(ownerOf(res), param(req.params.id)));
    },

    async versions(req: Request, res: Response) {
      res.json({ versions: await fracs.versions(ownerOf(res), param(req.params.id)) });
    },

    async restore(req: Request, res: Response) {
      const versionId = parseInput(versionIdSchema, req.params.versionId);
      res.json({ frac: await fracs.restore(ownerOf(res), param(req.params.id), versionId) });
    },
  };
}
