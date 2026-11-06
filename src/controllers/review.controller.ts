// HTTP handlers for /v1/frac-reviews: read params and the owner, call ReviewService, shape the response.
// Upload errors: 400 FILE_REQUIRED (no file), 400 FILE_TYPE_NOT_ALLOWED (not .xlsx).
import type { Request, Response } from "express";
import { ownerOf } from "../middleware/auth.ts";
import type { ReviewService } from "../services/review.service.ts";
import { badRequest } from "../utils/response.ts";
import type { ReviewContextInput } from "../validations/review.schema.ts";
import { param, sendXlsx } from "./http.ts";

/** HTTP handlers for the Reviewer (spec 8, /frac-reviews). */
export function reviewController(reviews: ReviewService) {
  return {
    /** Multipart: the workbook as `file`, context fields validated by the route. */
    async upload(req: Request, res: Response) {
      const file = req.file;
      if (!file) throw badRequest("FILE_REQUIRED", "Attach the FRAC workbook as 'file'");
      if (!/\.xlsx$/i.test(file.originalname)) throw badRequest("FILE_TYPE_NOT_ALLOWED", "Upload an .xlsx workbook");
      const { fresh, ...ctx } = req.body as ReviewContextInput;
      const started = await reviews.startUploadReview(ownerOf(res), { name: file.originalname, buffer: file.buffer }, ctx, fresh);
      // 200 with the stored review when this file and context were reviewed before; 202 with a job otherwise
      res.status(started.fromCache ? 200 : 202).json(started);
    },

    /** "Run a fresh review": re-asks the model and replaces the stored report. */
    async rerun(req: Request, res: Response) {
      res.status(202).json(await reviews.rerun(ownerOf(res), param(req.params.id)));
    },

    async list(_req: Request, res: Response) {
      res.json({ reviews: await reviews.list(ownerOf(res)) });
    },

    async get(req: Request, res: Response) {
      const review = await reviews.get(ownerOf(res), param(req.params.id));
      res.json({ report: review.report, ctx: review.ctx, sourceModel: review.sourceModel, kind: review.kind });
    },

    async exportWorkbook(req: Request, res: Response) {
      sendXlsx(res, await reviews.exportWorkbook(ownerOf(res), param(req.params.id)));
    },

    async openInCreator(req: Request, res: Response) {
      res.json({ fracId: await reviews.openInCreator(ownerOf(res), param(req.params.id)) });
    },
  };
}
