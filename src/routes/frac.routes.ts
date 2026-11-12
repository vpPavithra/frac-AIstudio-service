// Routes for /v1/fracs (Creator and My FRACs). Mounted by routes/index.ts. Bodies are validated here
// (validateBody) before the controller sees them.
import { Router } from "express";
import { documentController } from "../controllers/document.controller.ts";
import { fracController } from "../controllers/frac.controller.ts";
import { upload } from "../middleware/upload.ts";
import { validateBody } from "../middleware/validate.ts";
import type { DocumentService } from "../services/document.service.ts";
import type { FracService } from "../services/frac.service.ts";
import { createFracSchema, documentKindSchema, patchFracSchema, stepSchema } from "../validations/frac.schema.ts";

/** /fracs: Creator and My FRACs (spec 8), and the documents attached to a FRAC. Wiring only. */
export function fracRoutes(fracs: FracService, documents: DocumentService): Router {
  const c = fracController(fracs);
  const d = documentController(documents);
  const r = Router();
  r.post("/", validateBody(createFracSchema), c.create);
  r.get("/", c.list);
  // Registered before /:id so "match" is not read as a FRAC id
  r.get("/match", c.match);
  r.get("/:id", c.get);
  r.patch("/:id", validateBody(patchFracSchema), c.patch);
  // Registered before /:id/steps/:step so "check" is not treated as a generation step
  r.post("/:id/steps/check", c.startCheck);
  r.post("/:id/steps/:step", validateBody(stepSchema), c.startStep);
  r.get("/:id/export.xlsx", c.exportWorkbook);
  r.get("/:id/versions", c.versions);
  r.post("/:id/versions/:versionId/restore", c.restore);
  r.get("/:id/documents", d.list);
  // multer first, so the `kind` form field is in req.body for validateBody
  r.post("/:id/documents", upload.single("file"), validateBody(documentKindSchema), d.upload);
  r.delete("/:id/documents/:documentId", d.remove);
  return r;
}
