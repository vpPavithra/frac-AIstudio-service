import { Router } from "express";
import { jobController } from "../controllers/job.controller.js";
import type { JobRepository } from "../repositories/types.js";
import type { FracService } from "../services/frac.service.js";
import type { ReviewService } from "../services/review.service.js";
import { fracRoutes } from "./frac.routes.js";
import { reviewRoutes } from "./review.routes.js";

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
