// PER-USER REQUEST LIMITS (security review, 16 Nov 2026). AI jobs already have their own limits (2 running, a daily
// budget); this caps every /v1 request per user, and uploads (documents and Review FRAC workbooks, which are parsed in
// memory) more tightly. Fixed one-minute windows kept in this process: with several instances each counts on its own,
// which is enough to stop a runaway script or a stuck client. Over the limit: 429 RATE_LIMITED with Retry-After.
// Mounted in app.ts after requireOwner, so the key is the signed-in user, never something the caller chose.
import type { NextFunction, Request, Response } from "express";
import { RATE } from "../config/constants.ts";
import { ApiError } from "../utils/response.ts";
import { ownerOf } from "./auth.ts";

const WINDOW_MS = 60_000;
/** Above this many tracked keys, finished windows are dropped so the map cannot grow without bound. */
const PRUNE_ABOVE = 10_000;

/** POST to a FRAC's documents, or a new Review FRAC upload. */
export const isUpload = (req: Request) => req.method === "POST" && (/\/documents\/?$/.test(req.path) || /^\/frac-reviews\/?$/.test(req.path));

interface Window {
  start: number;
  count: number;
}

/**
 * The limiter: `perMinute` requests per user, and `uploadsPerMinute` of those may be uploads. `now` is injectable for
 * tests. A limit of 0 turns that limit off.
 */
export function rateLimitPerOwner(perMinute = RATE.perMinute, uploadsPerMinute = RATE.uploadsPerMinute, now = () => Date.now()) {
  const windows = new Map<string, Window>();

  /** Counts this request under `key`; returns the seconds to wait when it is over `limit`, else 0. */
  const hit = (key: string, limit: number, at: number): number => {
    if (!limit) return 0;
    let w = windows.get(key);
    if (!w || at - w.start >= WINDOW_MS) {
      w = { start: at, count: 0 };
      windows.set(key, w);
    }
    w.count += 1;
    return w.count > limit ? Math.ceil((w.start + WINDOW_MS - at) / 1000) : 0;
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    const at = now();
    if (windows.size > PRUNE_ABOVE) {
      for (const [key, w] of windows) if (at - w.start >= WINDOW_MS) windows.delete(key);
    }
    const owner = ownerOf(res);
    const wait = Math.max(hit(`all:${owner}`, perMinute, at), isUpload(req) ? hit(`upload:${owner}`, uploadsPerMinute, at) : 0);
    if (wait) {
      res.setHeader("Retry-After", String(wait));
      next(new ApiError(429, "RATE_LIMITED", `Too many requests. Wait ${wait} seconds and try again.`));
      return;
    }
    next();
  };
}
