import { LOG } from "../config/constants.js";
import { currentReqId } from "./request-context.js";

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
 * Structured logger: one JSON object per line in production (LOG_FORMAT=json), readable text
 * locally. Adds the request id when called inside a request. Use instead of console.*.
 */
export const logger = {
  debug: (message: string, fields: Fields = {}) => write("debug", message, fields),
  info: (message: string, fields: Fields = {}) => write("info", message, fields),
  warn: (message: string, fields: Fields = {}) => write("warn", message, fields),
  error: (message: string, fields: Fields = {}) => write("error", message, fields),
};
