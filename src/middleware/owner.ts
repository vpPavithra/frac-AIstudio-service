import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errors.js";

/**
 * Set by sunbird-cb-uiproxy (protectedApi_v8/fracStudio, via the AI Studio helpers) from the
 * signed-in user's session, overwriting any value the browser sent. Same header AI Studio uses.
 */
export const USER_ID_HEADER = "x-aastrika-creator";

/**
 * The owner always comes from the proxy-forwarded header, never from the request body or a
 * query param. This service must only be reachable through the proxy (cluster-internal), since
 * it trusts that header.
 */
export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  const ownerId = req.header(USER_ID_HEADER)?.trim();
  if (!ownerId) {
    next(new HttpError(401, "Missing user identity"));
    return;
  }
  res.locals.ownerId = ownerId;
  next();
}

export function ownerOf(res: Response): string {
  return res.locals.ownerId as string;
}
