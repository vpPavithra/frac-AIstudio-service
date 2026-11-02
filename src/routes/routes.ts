import { Router, type Response } from "express";
import multer from "multer";
import type { JobRepository } from "../repositories/types.js";
import { badRequest, HttpError, notFound } from "../middleware/errors.js";
import { ownerOf } from "../middleware/owner.js";
import type { FracService } from "../services/frac.service.js";
import type { ReviewService } from "../services/review.service.js";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// Generation steps that need the LLM layer (spec 5.2–5.5); /steps/check is live
const PENDING_STEPS = ["research", "roles", "competencies", "ladders"];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

function sendXlsx(res: Response, file: { buffer: Buffer; filename: string }): void {
  res.setHeader("Content-Type", XLSX_MIME);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
  res.send(file.buffer);
}

const optionalText = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export interface RouteDeps {
  fracs: FracService;
  reviews: ReviewService;
  jobs: JobRepository;
}

/** Spec 8 under /v1. Every route expects requireOwner to have run. */
export function apiRoutes({ fracs, reviews, jobs }: RouteDeps): Router {
  const r = Router();

  r.post("/fracs", async (req, res) => {
    const frac = await fracs.create(ownerOf(res), req.body ?? {});
    res.status(201).json({ id: frac.id, frac });
  });
  r.get("/fracs", async (_req, res) => {
    res.json({ fracs: await fracs.list(ownerOf(res)) });
  });
  r.get("/fracs/:id", async (req, res) => {
    res.json({ frac: await fracs.get(ownerOf(res), req.params.id) });
  });
  r.patch("/fracs/:id", async (req, res) => {
    res.json({ frac: await fracs.patch(ownerOf(res), req.params.id, req.body ?? {}) });
  });
  r.post("/fracs/:id/steps/check", async (req, res) => {
    const job = await fracs.startCheck(ownerOf(res), req.params.id);
    res.status(202).json({ jobId: job.id });
  });
  r.post("/fracs/:id/steps/:step", async (req, res) => {
    if (!PENDING_STEPS.includes(req.params.step)) throw notFound("Step");
    await fracs.get(ownerOf(res), req.params.id);
    throw new HttpError(501, `The ${req.params.step} step is not available yet`);
  });
  r.get("/fracs/:id/export.xlsx", async (req, res) => {
    sendXlsx(res, await fracs.exportWorkbook(ownerOf(res), req.params.id));
  });
  r.get("/fracs/:id/versions", async (req, res) => {
    res.json({ versions: await fracs.versions(ownerOf(res), req.params.id) });
  });
  r.post("/fracs/:id/versions/:versionId/restore", async (req, res) => {
    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(versionId)) throw badRequest("versionId must be a number");
    res.json({ frac: await fracs.restore(ownerOf(res), req.params.id, versionId) });
  });

  r.post("/frac-reviews", upload.single("file"), async (req, res) => {
    const file = req.file;
    if (!file) throw badRequest("Attach the FRAC workbook as 'file'");
    if (!/\.xlsx$/i.test(file.originalname)) throw badRequest("Upload an .xlsx workbook");
    const ctx = {
      cadre: optionalText(req.body?.cadre),
      state: optionalText(req.body?.state),
      notes: optionalText(req.body?.notes),
    };
    const started = await reviews.startUploadReview(ownerOf(res), { name: file.originalname, buffer: file.buffer }, ctx);
    res.status(202).json(started);
  });
  r.get("/frac-reviews", async (_req, res) => {
    res.json({ reviews: await reviews.list(ownerOf(res)) });
  });
  r.get("/frac-reviews/:id", async (req, res) => {
    const review = await reviews.get(ownerOf(res), req.params.id);
    res.json({ report: review.report, ctx: review.ctx, sourceModel: review.sourceModel, kind: review.kind });
  });
  r.get("/frac-reviews/:id/export.xlsx", async (req, res) => {
    sendXlsx(res, await reviews.exportWorkbook(ownerOf(res), req.params.id));
  });
  r.post("/frac-reviews/:id/open-in-creator", async (req, res) => {
    res.json({ fracId: await reviews.openInCreator(ownerOf(res), req.params.id) });
  });

  r.get("/jobs/:id", async (req, res) => {
    const job = await jobs.get(req.params.id);
    if (!job || job.ownerId !== ownerOf(res)) throw notFound("Job");
    const { status, msg, done, total, error, kind, targetId } = job;
    res.json({ status, msg, done, total, error, kind, targetId });
  });

  return r;
}
