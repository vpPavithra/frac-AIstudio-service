// Access log, mounted by app.ts right after requestContext so each line carries the request id.
// The error code comes from res.locals.errorCode, which sendError (utils/response.ts) sets.
import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger.ts";

const QUIET_PATHS = new Set(["/health"]);

/**
 * One access line per request: method, path, status, duration and the error code when there was
 * one. Health checks are skipped so probes do not drown the log.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (QUIET_PATHS.has(req.path)) {
    next();
    return;
  }
  const started = Date.now();
  res.on("finish", () => {
    const fields: Record<string, unknown> = { status: res.statusCode, ms: Date.now() - started };
    if (res.locals.errorCode) fields.code = res.locals.errorCode;
    const line = `${req.method} ${req.originalUrl.split("?")[0]}`;
    if (res.statusCode >= 500) logger.error(line, fields);
    else if (res.statusCode >= 400) logger.warn(line, fields);
    else logger.info(line, fields);
  });
  next();
}
