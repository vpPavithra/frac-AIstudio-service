import { Router } from "express";
import { reviewController } from "../controllers/review.controller.js";
import { upload } from "../middleware/upload.js";
import { validateBody } from "../middleware/validate.js";
import type { ReviewService } from "../services/review.service.js";
import { reviewContextSchema } from "../validations/review.schema.js";

/** /frac-reviews: the Reviewer (spec 8). */
export function reviewRoutes(reviews: ReviewService): Router {
  const c = reviewController(reviews);
  const r = Router();
  r.post("/", upload.single("file"), validateBody(reviewContextSchema), c.upload);
  r.get("/", c.list);
  r.get("/:id", c.get);
  r.get("/:id/export.xlsx", c.exportWorkbook);
  r.post("/:id/open-in-creator", c.openInCreator);
  return r;
}
