import { LOG } from "../config/constants.ts";
import { currentReqId } from "./context.ts";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function write(level: Level, message: string, fields: Fields): void {
  if (RANK[level] < RANK[LOG.level]) return;
  const reqId = currentReqId();
  const record = { ...fields, ...(reqId ? { reqId } : {}) };
  const out = level === "error" || level === "warn" ? process.stderr : process.stdout;
  if (LOG.format === "json") {
    out.write(`${JSON.stringify({ t: new Date().toISOString(), level, msg: message, ...record })}\n`);
    return;
  }
  const extras = Object.keys(record).length ? ` ${JSON.stringify(record)}` : "";
  out.write(`${level.toUpperCase().padEnd(5)} ${message}${extras}\n`);
}

/**
 * A one-line description of any thrown value. Some errors carry no message: a refused Postgres
 * connection is an AggregateError with message "" and the detail in `code` and `errors[]`
 * ("ECONNREFUSED ::1:5432"). Those details are included so a log line never says just "".
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const { code, address, port } = err as Error & { code?: string; address?: string; port?: number };
  const where = address ? ` ${address}${port ? `:${port}` : ""}` : "";
  const own = err.message || (code ? `${code}${where}` : err.name);
  const inner = err instanceof AggregateError ? err.errors.map(describeError).filter((d) => d && d !== own) : [];
  return inner.length ? `${own}${own ? ": " : ""}${inner.join("; ")}` : own;
}

/**
 * Structured logger: one JSON object per line in production (LOG_FORMAT=json), readable text
 * locally. Adds the request id when called inside a request. Use instead of console.*.
 */
export const logger = {
  debug: (message: string, fields: Fields = {}) => write("debug", message, fields),
  info: (message: string, fields: Fields = {}) => write("info", message, fields),
  warn: (message: string, fields: Fields = {}) => write("warn", message, fields),
  error: (message: string, fields: Fields = {}) => write("error", message, fields),
};
