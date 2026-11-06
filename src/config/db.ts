// Postgres connection for the service and the migrate command. Reads POSTGRES_HOST, POSTGRES_PORT,
// POSTGRES_DATABASE, POSTGRES_USER and POSTGRES_PASSWORD straight from the environment (per-deployment
// values and a secret, so not in config/service.json). Pool sizing comes from DB in constants.ts
// (POSTGRES_POOL_MAX, POSTGRES_CONNECT_TIMEOUT_MS, POSTGRES_IDLE_TIMEOUT_MS). Called by server.ts and migrate.ts.
import pg from "pg";
import { DB } from "./constants.ts";

/** "host:port/database" for messages; never includes the user or password. */
export function poolTarget(env = process.env): string {
  return `${env.POSTGRES_HOST || "localhost"}:${env.POSTGRES_PORT || 5432}/${env.POSTGRES_DATABASE || "(default database)"}`;
}

/** Pool for the shared AI Studio / AskMe Postgres (spec 2). */
export function createPool(env = process.env): pg.Pool {
  return new pg.Pool({
    host: env.POSTGRES_HOST,
    port: Number(env.POSTGRES_PORT ?? 5432),
    database: env.POSTGRES_DATABASE,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    max: DB.poolMax,
    connectionTimeoutMillis: DB.connectTimeoutMs,
    idleTimeoutMillis: DB.idleTimeoutMs,
  });
}
