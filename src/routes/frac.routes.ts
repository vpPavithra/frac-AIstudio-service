// Routes for /v1/fracs (Creator and My FRACs). Mounted by routes/index.ts. Bodies are validated here
// (validateBody) before the controller sees them.
import { Router } from "express";
import { fracController } from "../controllers/frac.controller.ts";
import { validateBody } from "../middleware/validate.ts";
import type { FracService } from "../services/frac.service.ts";
import { createFracSchema, patchFracSchema, stepSchema } from "../validations/frac.schema.ts";

/** /fracs: Creator and My FRACs (spec 8). Wiring only; logic is in the controller and service. */
export function fracRoutes(fracs: FracService): Router {
  const c = fracController(fracs);
  const r = Router();
  r.post("/", validateBody(createFracSchema), c.create);
  r.get("/", c.list);
  r.get("/:id", c.get);
  r.patch("/:id", validateBody(patchFracSchema), c.patch);
  // Registered before /:id/steps/:step so "check" is not treated as a generation step
  r.post("/:id/steps/check", c.startCheck);
  r.post("/:id/steps/:step", validateBody(stepSchema), c.startStep);
  r.get("/:id/export.xlsx", c.exportWorkbook);
  r.get("/:id/versions", c.versions);
  r.post("/:id/versions/:versionId/restore", c.restore);
  return r;
}
