import pg from "pg";

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
  });
}
