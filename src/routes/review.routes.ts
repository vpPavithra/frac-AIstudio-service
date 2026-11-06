// Routes for /v1/frac-reviews (Reviewer). Mounted by routes/index.ts. The upload route runs multer
// first, so the form fields are in req.body by the time validateBody checks them.
import { Router } from "express";
import { reviewController } from "../controllers/review.controller.ts";
import { upload } from "../middleware/upload.ts";
import { validateBody } from "../middleware/validate.ts";
import type { ReviewService } from "../services/review.service.ts";
import { reviewContextSchema } from "../validations/review.schema.ts";

/** /frac-reviews: the Reviewer (spec 8). */
export function reviewRoutes(reviews: ReviewService): Router {
  const c = reviewController(reviews);
  const r = Router();
  r.post("/", upload.single("file"), validateBody(reviewContextSchema), c.upload);
  r.get("/", c.list);
  r.get("/:id", c.get);
  r.get("/:id/export.xlsx", c.exportWorkbook);
  r.post("/:id/open-in-creator", c.openInCreator);
  r.post("/:id/rerun", c.rerun);
  return r;
}
