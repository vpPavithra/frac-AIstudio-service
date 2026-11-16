import type { NextFunction, Request, Response } from "express";
import { rateLimitPerOwner } from "./rate-limit.ts";

function call(limiter: ReturnType<typeof rateLimitPerOwner>, owner: string, method = "GET", path = "/fracs") {
  const headers: Record<string, string> = {};
  const res = { locals: { ownerId: owner }, setHeader: (k: string, v: string) => (headers[k] = v) } as unknown as Response;
  let error: unknown;
  limiter({ method, path } as Request, res, ((err?: unknown) => (error = err)) as NextFunction);
  return { error, headers };
}

describe("rateLimitPerOwner", () => {
  it("allows the limit per user per minute, then answers 429 with Retry-After", () => {
    let t = 0;
    const limiter = rateLimitPerOwner(3, 0, () => t);
    for (let i = 0; i < 3; i++) expect(call(limiter, "u1").error).toBeUndefined();
    t = 15_000;
    const over = call(limiter, "u1");
    expect(over.error).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(over.headers["Retry-After"]).toBe("45");
    // Another user has their own window, and a new minute starts afresh
    expect(call(limiter, "u2").error).toBeUndefined();
    t = 60_000;
    expect(call(limiter, "u1").error).toBeUndefined();
  });

  it("limits uploads more tightly than other requests", () => {
    const limiter = rateLimitPerOwner(100, 2, () => 0);
    expect(call(limiter, "u1", "POST", "/fracs/f1/documents").error).toBeUndefined();
    expect(call(limiter, "u1", "POST", "/frac-reviews").error).toBeUndefined();
    expect(call(limiter, "u1", "POST", "/fracs/f1/documents").error).toMatchObject({ status: 429 });
    expect(call(limiter, "u1", "GET", "/fracs/f1").error).toBeUndefined();
  });

  it("turns a limit off at 0", () => {
    const limiter = rateLimitPerOwner(0, 0, () => 0);
    for (let i = 0; i < 500; i++) expect(call(limiter, "u1").error).toBeUndefined();
  });
});
