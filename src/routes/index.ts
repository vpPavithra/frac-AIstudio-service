// The /v1 API router. app.ts mounts it behind requireOwner, so every route here has an owner.
// Splits into /fracs, /frac-reviews, /templates/:kind, /jobs/:id and /info.
import { Router } from "express";
import { documentController } from "../controllers/document.controller.ts";
import { jobController } from "../controllers/job.controller.ts";
import type { TextProvider } from "../providers/text/types.ts";
import type { JobRepository } from "../repositories/job.repository.ts";
import type { DocumentService } from "../services/document.service.ts";
import type { FracService } from "../services/frac.service.ts";
import type { ReviewService } from "../services/review.service.ts";
import { fracRoutes } from "./frac.routes.ts";
import { reviewRoutes } from "./review.routes.ts";

/** Everything the routes need, built once in server.ts (or a test) and passed to createApp. */
export interface RouteDeps {
  fracs: FracService;
  /** Documents on a FRAC (brief documents and standard sheets) and the upload templates. */
  documents: DocumentService;
  reviews: ReviewService;
  jobs: JobRepository;
  /** Only its name is exposed (GET /v1/info: the profile name, e.g. "claude", or "mock"). */
  provider: Pick<TextProvider, "name">;
}

/** Spec 8 API, mounted under /v1 behind requireOwner. */
export function apiRoutes({ fracs, documents, reviews, jobs, provider }: RouteDeps): Router {
  const r = Router();
  r.use("/fracs", fracRoutes(fracs, documents));
  // The sheet or guide a team fills in before uploading (brief, roles, competencies, sources)
  r.get("/templates/:kind", documentController(documents).template);
  r.use("/frac-reviews", reviewRoutes(reviews));
  r.get("/jobs/:id", jobController(jobs).get);
  // Which AI provider answers (the AI_PROVIDER profile name, or mock)
  r.get("/info", (_req, res) => {
    res.json({ aiProvider: provider.name });
  });
  return r;
}
