import type { Request, Response } from "express";
import { ownerOf } from "../middleware/owner.js";
import type { JobRepository } from "../repositories/types.js";
import { notFound } from "../utils/api-error.js";
import { param } from "./http.js";

/** GET /jobs/:id: what the portal polls while a step runs. */
export function jobController(jobs: JobRepository) {
  return {
    async get(req: Request, res: Response) {
      const job = await jobs.get(param(req.params.id));
      if (!job || job.ownerId !== ownerOf(res)) throw notFound("Job");
      const { status, msg, done, total, error, errorCode, kind, targetId } = job;
      res.json({ status, msg, done, total, error, errorCode, kind, targetId });
    },
  };
}
