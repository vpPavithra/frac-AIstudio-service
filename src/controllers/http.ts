// Small HTTP helpers shared by the controllers (Excel download, route params).
import type { Response } from "express";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Sends an Excel download with an RFC 5987 filename (survives spaces and non-ASCII). */
export function sendXlsx(res: Response, file: { buffer: Buffer; filename: string }): void {
  res.setHeader("Content-Type", XLSX_MIME);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
  res.send(file.buffer);
}

/** Express 5 types route params as string | string[]; ours are always single segments. */
export function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : (value ?? "");
}
