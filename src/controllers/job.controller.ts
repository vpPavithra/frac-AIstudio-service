// Handler for GET /v1/jobs/:id. Reads the job straight from the JobRepository (no service layer)
// and returns only the fields the portal needs.
import type { Request, Response } from "express";
import { ownerOf } from "../middleware/auth.ts";
import type { JobRepository } from "../repositories/job.repository.ts";
import { notFound } from "../utils/response.ts";
import { param } from "./http.ts";

/** GET /jobs/:id: what the portal polls while a step runs; `usage` is the model spend so far (spec 9). */
export function jobController(jobs: JobRepository) {
  return {
    async get(req: Request, res: Response) {
      const job = await jobs.get(param(req.params.id));
      // Another owner's job is reported as missing (404), so job ids cannot be probed
      if (!job || job.ownerId !== ownerOf(res)) throw notFound("Job");
      const { status, msg, done, total, error, errorCode, kind, targetId, usage } = job;
      res.json({ status, msg, done, total, error, errorCode, kind, targetId, usage });
    },
  };
}
