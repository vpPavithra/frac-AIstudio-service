// Identity for every /v1 request. app.ts mounts requireOwner in front of all API routes; controllers
// then read the owner with ownerOf(res) and pass it to the services, which scope every read by it.
import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { AUTH } from "../config/constants.ts";
import { unauthorized } from "../utils/response.ts";

/** The header carrying AUTH.serviceKey, set by the uiproxy only; a browser cannot know the key. */
export const SERVICE_KEY_HEADER = "x-service-key";

/** Compares in constant time, so the key cannot be guessed a character at a time from response timing. */
function sameKey(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Proof the request came through the uiproxy (security review, 16 Nov 2026): x-user-id is trusted only when the
 * request also carries the shared service key. Without it anyone who could reach the service could name any user.
 * Runs before requireOwner. With no key configured (local runs) it lets requests through; server.ts refuses to start
 * that way in production. Missing or wrong key: 401 NOT_FROM_PROXY.
 */
export function serviceKeyCheck(expected: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!expected || sameKey(req.header(SERVICE_KEY_HEADER) ?? "", expected)) {
      next();
      return;
    }
    next(unauthorized("This service accepts requests only through the portal proxy", "NOT_FROM_PROXY"));
  };
}

/** The check with the configured AUTH.serviceKey, as app.ts mounts it. */
export const requireServiceKey = serviceKeyCheck(AUTH.serviceKey);

/**
 * Set by sunbird-cb-uiproxy (protectedApi_v8/fracStudio) from the signed-in user's session, overwriting any
 * value the browser sent. FRAC Studio's own header name; the proxy sends nothing else that identifies the user.
 */
export const USER_ID_HEADER = "x-user-id";

/**
 * The owner always comes from the proxy-forwarded header, never from the request body or a
 * query param, and is required: every record is scoped by it. Unlike the AI Studio service (where
 * the header is attribution only and defaults to "admin"), here it is authorisation, so there is
 * no fallback. The service must only be reachable through the proxy. Missing header: 401 NOT_SIGNED_IN.
 */
export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  const ownerId = req.header(USER_ID_HEADER)?.trim();
  if (!ownerId) {
    next(unauthorized("Missing user identity"));
    return;
  }
  res.locals.ownerId = ownerId;
  next();
}

/** The owner id requireOwner stored for this request. Only valid on routes behind requireOwner. */
export function ownerOf(res: Response): string {
  return res.locals.ownerId as string;
}
