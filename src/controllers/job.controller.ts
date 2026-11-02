import type { Request, Response } from "express";
import { ownerOf } from "../middleware/auth.ts";
import type { JobRepository } from "../repositories/job.repository.ts";
import { notFound } from "../utils/response.ts";
import { param } from "./http.ts";

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
