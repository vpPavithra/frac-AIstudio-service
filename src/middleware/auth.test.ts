import type { NextFunction, Request, Response } from "express";
import { requireOwner, serviceKeyCheck } from "./auth.ts";

const req = (headers: Record<string, string>) => ({ header: (name: string) => headers[name.toLowerCase()] }) as unknown as Request;
const run = (handler: (q: Request, r: Response, n: NextFunction) => void, headers: Record<string, string>) => {
  const calls: unknown[] = [];
  const res = { locals: {} } as unknown as Response;
  handler(req(headers), res, ((err?: unknown) => calls.push(err)) as NextFunction);
  return { error: calls[0], res };
};

describe("serviceKeyCheck", () => {
  const check = serviceKeyCheck("s3cret-key");

  it("lets a request with the right key through", () => {
    expect(run(check, { "x-service-key": "s3cret-key" }).error).toBeUndefined();
  });

  it("refuses a missing or wrong key with 401 NOT_FROM_PROXY", () => {
    for (const headers of [{}, { "x-service-key": "wrong" }, { "x-service-key": "s3cret-key-longer" }]) {
      expect(run(check, headers).error).toMatchObject({ status: 401, code: "NOT_FROM_PROXY" });
    }
  });

  it("checks nothing when no key is configured (local runs)", () => {
    expect(run(serviceKeyCheck(""), {}).error).toBeUndefined();
  });
});

describe("requireOwner", () => {
  it("needs x-user-id and stores it for the controllers", () => {
    expect(run(requireOwner, {}).error).toMatchObject({ status: 401, code: "NOT_SIGNED_IN" });
    expect(run(requireOwner, { "x-user-id": " u1 " }).res.locals.ownerId).toBe("u1");
  });
});
