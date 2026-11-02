import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errors.js";

/** Header set by sunbird-cb-uiproxy's buildProxyHeaders from the user's session. */
export const USER_ID_HEADER = "x-authenticated-userid";

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
