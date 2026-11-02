import type { Request, Response } from "express";
import { parseInput } from "../middleware/validate.ts";
import { ownerOf } from "../middleware/auth.ts";
import type { FracService } from "../services/frac.service.ts";
import { notFound, notImplemented } from "../utils/response.ts";
import { versionIdSchema, type CreateFracInput, type PatchFracInput } from "../validations/frac.schema.ts";
import { param, sendXlsx } from "./http.ts";

/** Generation steps that need the LLM layer (spec 5.2–5.5); `check` is live. */
const PENDING_STEPS = new Set(["research", "roles", "competencies", "ladders"]);

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

    async get(req: Request, res: Response) {
      res.json({ frac: await fracs.get(ownerOf(res), param(req.params.id)) });
    },

    async patch(req: Request, res: Response) {
      res.json({ frac: await fracs.patch(ownerOf(res), param(req.params.id), req.body as PatchFracInput) });
    },

    async startCheck(req: Request, res: Response) {
      const job = await fracs.startCheck(ownerOf(res), param(req.params.id));
      res.status(202).json({ jobId: job.id });
    },

    /** Steps 2–5 exist in the API contract but answer 501 until the AI layer is built. */
    async startPendingStep(req: Request, res: Response) {
      const step = param(req.params.step);
      if (!PENDING_STEPS.has(step)) throw notFound("Step");
      await fracs.get(ownerOf(res), param(req.params.id));
      throw notImplemented("STEP_NOT_AVAILABLE", `The ${step} step is not available yet`);
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
