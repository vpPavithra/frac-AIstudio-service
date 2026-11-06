// One error shape for the whole API, as in aastrika-ai-service (utils/response.ts).
//
// A client cannot branch on prose, so every failure carries a stable machine-readable code next
// to the sentence a person reads. 4xx means "the request was wrong, do not retry"; 5xx means
// "try again shortly". Services and controllers throw these; middleware/errorHandler.ts writes them.
import type { Response } from "express";

/** The JSON body of every error response. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/**
 * An error the client should see: HTTP `status`, stable `code` for the client to branch on, a message
 * a person can read, and optional `details` (e.g. every validation issue). Throw it; do not send it.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Shorthands for the common statuses. Codes fixed here: NOT_SIGNED_IN (401), NOT_FOUND (404), PAYLOAD_TOO_LARGE (413)
export const badRequest = (code: string, message: string, details?: unknown) =>
  new ApiError(400, code, message, details);
export const unauthorized = (message = "Not signed in") => new ApiError(401, "NOT_SIGNED_IN", message);
export const notFound = (what: string) => new ApiError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const payloadTooLarge = (message: string) => new ApiError(413, "PAYLOAD_TOO_LARGE", message);
export const notImplemented = (code: string, message: string) => new ApiError(501, code, message);

/** Writes the error body and records the code for the access log. */
export function sendError(res: Response, err: ApiError): void {
  const body: ApiErrorBody = { error: { code: err.code, message: err.message } };
  if (err.details !== undefined) body.error.details = err.details;
  res.locals.errorCode = err.code;
  res.status(err.status).json(body);
}
