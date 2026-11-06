// GET /health, mounted in app.ts outside /v1, so it needs no owner header. Used by the Docker
// HEALTHCHECK and Kubernetes probes. It only says the process is up; it does not touch Postgres.
import type { Request, Response } from "express";

/** Liveness answer: 200 with a fixed body. requestLogger skips this path so probes do not flood the log. */
export function health(_req: Request, res: Response): void {
  res.json({ status: "ok", service: "frac-studio-service" });
}
