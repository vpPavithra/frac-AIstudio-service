import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** The slice of pg's Client/Pool this runner needs, so tests can pass a fake. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface Migration {
  name: string;
  sql: string;
}

// Any fixed number: every replica takes the same lock, so only one applies migrations at a time
const LOCK_KEY = 7_272_026;

/** Files in run order. Names sort lexically, so keep the zero-padded prefix (001_, 002_ …). */
export function loadMigrations(dir = path.resolve(process.cwd(), "migrations")): Migration[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(path.join(dir, name), "utf8") }));
}

export function pendingMigrations(all: Migration[], applied: Set<string>): Migration[] {
  return all.filter((m) => !applied.has(m.name));
}

/**
 * Applies every migration not yet recorded in schema_migrations, each in its own transaction,
 * under an advisory lock so concurrent pods do not race. Returns the names it applied.
 */
export async function runMigrations(db: Queryable, migrations: Migration[]): Promise<string[]> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  await db.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  try {
    const { rows } = await db.query("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((r) => String(r.name)));
    const done: string[] = [];
    for (const migration of pendingMigrations(migrations, applied)) {
      await db.query("BEGIN");
      try {
        await db.query(migration.sql);
        await db.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migration.name]);
        await db.query("COMMIT");
        done.push(migration.name);
      } catch (err) {
        await db.query("ROLLBACK");
        throw new Error(`Migration ${migration.name} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return done;
  } finally {
    await db.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
  }
}
