// The /v1 API router. app.ts mounts it behind requireOwner, so every route here has an owner.
// Splits into /fracs, /frac-reviews, /jobs/:id and /info.
import { Router } from "express";
import { jobController } from "../controllers/job.controller.ts";
import type { TextProvider } from "../providers/text/types.ts";
import type { JobRepository } from "../repositories/job.repository.ts";
import type { FracService } from "../services/frac.service.ts";
import type { ReviewService } from "../services/review.service.ts";
import { fracRoutes } from "./frac.routes.ts";
import { reviewRoutes } from "./review.routes.ts";

/** Everything the routes need, built once in server.ts (or a test) and passed to createApp. */
export interface RouteDeps {
  fracs: FracService;
  reviews: ReviewService;
  jobs: JobRepository;
  /** Only its name is exposed (GET /v1/info: "claude" or "mock"). */
  provider: Pick<TextProvider, "name">;
}

/** Spec 8 API, mounted under /v1 behind requireOwner. */
export function apiRoutes({ fracs, reviews, jobs, provider }: RouteDeps): Router {
  const r = Router();
  r.use("/fracs", fracRoutes(fracs));
  r.use("/frac-reviews", reviewRoutes(reviews));
  r.get("/jobs/:id", jobController(jobs).get);
  // Which AI provider answers (claude, or mock when no API key is set)
  r.get("/info", (_req, res) => {
    res.json({ aiProvider: provider.name });
  });
  return r;
}
