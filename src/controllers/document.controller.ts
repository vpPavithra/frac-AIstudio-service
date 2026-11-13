// HTTP handlers for documents on a FRAC (/v1/fracs/:id/documents) and the upload templates
// (/v1/templates/:kind). No rules live here; DocumentService has them. Upload errors: 400 FILE_REQUIRED.
import type { Request, Response } from "express";
import { ownerOf } from "../middleware/auth.ts";
import { parseInput } from "../middleware/validate.ts";
import { DocumentService } from "../services/document.service.ts";
import { badRequest } from "../utils/response.ts";
import { documentKindSchema, type DocumentKindInput } from "../validations/frac.schema.ts";
import { param, sendXlsx } from "./http.ts";

export function documentController(documents: DocumentService) {
  return {
    async list(req: Request, res: Response) {
      res.json({ documents: await documents.list(ownerOf(res), param(req.params.id)) });
    },

    /** Multipart: the file as `file`, `kind` validated by the route. 201 with the document and the FRAC after the upload. */
    async upload(req: Request, res: Response) {
      const file = req.file;
      if (!file) throw badRequest("FILE_REQUIRED", "Attach the document as 'file'");
      const { kind } = req.body as DocumentKindInput;
      const result = await documents.upload(ownerOf(res), param(req.params.id), kind, { name: file.originalname, buffer: file.buffer, mime: file.mimetype });
      res.status(201).json(result);
    },

    /** Re-applies an uploaded sheet's rows over edits made since; answers with the FRAC. */
    async reapply(req: Request, res: Response) {
      res.json({ frac: await documents.reapply(ownerOf(res), param(req.params.id), param(req.params.documentId)) });
    },

    async remove(req: Request, res: Response) {
      res.json({ frac: await documents.remove(ownerOf(res), param(req.params.id), param(req.params.documentId)) });
    },

    /** The template for a kind: .xlsx for the sheets, a text guide for brief documents. */
    async template(req: Request, res: Response) {
      const { kind } = parseInput(documentKindSchema, { kind: param(req.params.kind) });
      const file = await DocumentService.template(kind);
      if (file.type === "xlsx") {
        sendXlsx(res, file);
        return;
      }
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
      res.send(file.buffer);
    },
  };
}
