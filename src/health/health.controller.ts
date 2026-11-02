import type { Request, Response } from "express";

export function health(_req: Request, res: Response): void {
  res.json({ status: "ok", service: "frac-studio-service" });
}
