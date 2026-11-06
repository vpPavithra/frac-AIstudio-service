// The last middleware in app.ts: turns anything thrown or passed to next(err) into the one error body
// `{ error: { code, message, details? } }` (utils/response.ts). Also maps errors from libraries that do
// not know about ApiError: the workbook parser, multer uploads and body-parser.
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { WorkbookParseError } from "../services/review-engine/parse-workbook.ts";
import { ApiError, payloadTooLarge, sendError } from "../utils/response.ts";
import { describeError, logger } from "../utils/logger.ts";

/** body-parser marks its own failures with a `type`; these are the client's fault, not ours. */
function bodyParserError(err: unknown): ApiError | null {
  const type = (err as { type?: unknown } | null)?.type;
  if (type === "entity.parse.failed") return new ApiError(400, "INVALID_JSON", "The request body is not valid JSON");
  if (type === "entity.too.large") return payloadTooLarge("The request body is too large");
  return null;
}

/**
 * Maps known failures to their code; anything else is a 500 with a generic message, logged.
 * Codes: ApiError keeps its own; WorkbookParseError → 400 NO_COMPETENCY_SHEET; multer → 413
 * PAYLOAD_TOO_LARGE or 400 UPLOAD_INVALID; bad JSON → 400 INVALID_JSON; unknown → 500 INTERNAL_ERROR.
 * Express 5 forwards rejected async handlers here, so controllers simply throw.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    sendError(res, err);
    return;
  }
  if (err instanceof WorkbookParseError) {
    sendError(res, new ApiError(400, "NO_COMPETENCY_SHEET", err.message));
    return;
  }
  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === "LIMIT_FILE_SIZE";
    sendError(res, tooLarge ? payloadTooLarge("The file is too large") : new ApiError(400, "UPLOAD_INVALID", err.message));
    return;
  }
  const parsed = bodyParserError(err);
  if (parsed) {
    sendError(res, parsed);
    return;
  }
  logger.error("Unhandled error", { error: describeError(err), stack: err instanceof Error ? err.stack : undefined });
  sendError(res, new ApiError(500, "INTERNAL_ERROR", "Something went wrong"));
}
