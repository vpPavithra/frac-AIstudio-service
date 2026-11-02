import type { NextFunction, Request, Response } from "express";
import type { ZodType, ZodTypeDef } from "zod";
import { badRequest } from "../utils/api-error.js";

/**
 * Parses a value with a schema or throws VALIDATION_FAILED. The message names the first problem
 * in words a person can act on; `details` lists every problem with its path.
 */
export function parseInput<T>(schema: ZodType<T, ZodTypeDef, unknown>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  const first = issues[0];
  throw badRequest("VALIDATION_FAILED", first.path ? `${first.path}: ${first.message}` : first.message, issues);
}

/**
 * Replaces req.body with the parsed value. Fields the schema does not declare are dropped,
 * so every field a handler needs must be in the schema (aastrika-ai-service rule).
 */
export function validateBody<T>(schema: ZodType<T, ZodTypeDef, unknown>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.body = parseInput(schema, req.body ?? {});
    next();
  };
}
