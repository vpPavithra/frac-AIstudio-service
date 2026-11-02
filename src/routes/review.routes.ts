import { Router } from "express";
import multer from "multer";
import { LIMITS } from "../config/constants.js";
import { reviewController } from "../controllers/review.controller.js";
import { validateBody } from "../middleware/validate.js";
import type { ReviewService } from "../services/review.service.js";
import { reviewContextSchema } from "../validations/review.schema.js";

const BYTES_PER_MB = 1024 * 1024;

/** /frac-reviews: the Reviewer (spec 8). Uploads are held in memory and capped by MAX_UPLOAD_MB. */
export function reviewRoutes(reviews: ReviewService): Router {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LIMITS.maxUploadMb * BYTES_PER_MB, files: 1 },
  });
  const c = reviewController(reviews);
  const r = Router();
  r.post("/", upload.single("file"), validateBody(reviewContextSchema), c.upload);
  r.get("/", c.list);
  r.get("/:id", c.get);
  r.get("/:id/export.xlsx", c.exportWorkbook);
  r.post("/:id/open-in-creator", c.openInCreator);
  return r;
}
