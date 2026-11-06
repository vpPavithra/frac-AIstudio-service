// First middleware in app.ts. Starts the per-request AsyncLocalStorage context (utils/context.ts)
// that utils/logger.ts reads to stamp the request id on every log line.
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { requestContext } from "../utils/context.ts";

const REQUEST_ID_HEADER = "x-request-id";
// A caller-supplied id is reused only if it is short and plain, so it cannot inject into log lines
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Gives every request an id (the caller's x-request-id when it is safe, else a new one), echoes
 * it back, and makes it available to every log line written while the request runs.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const reqId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, reqId);
  requestContext.run({ reqId }, () => next());
}
