import { Router } from "express";
import { jobController } from "../controllers/job.controller.ts";
import type { JobRepository } from "../repositories/job.repository.ts";
import type { FracService } from "../services/frac.service.ts";
import type { ReviewService } from "../services/review.service.ts";
import { fracRoutes } from "./frac.routes.ts";
import { reviewRoutes } from "./review.routes.ts";

export interface RouteDeps {
  fracs: FracService;
  reviews: ReviewService;
  jobs: JobRepository;
}

/** Spec 8 API, mounted under /v1 behind requireOwner. */
export function apiRoutes({ fracs, reviews, jobs }: RouteDeps): Router {
  const r = Router();
  r.use("/fracs", fracRoutes(fracs));
  r.use("/frac-reviews", reviewRoutes(reviews));
  r.get("/jobs/:id", jobController(jobs).get);
  return r;
}
