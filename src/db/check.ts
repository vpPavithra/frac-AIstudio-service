import { describeError } from "../utils/logger.ts";
import type { Queryable } from "./migrate.ts";

/**
 * Fails fast when Postgres cannot be reached, so the service refuses to start (as aastrika-ai-service
 * does) instead of starting and failing every request one at a time. `where` names the target in
 * the message, e.g. "localhost:5432/frac_studio".
 */
export async function checkDatabase(db: Queryable, where: string): Promise<void> {
  try {
    await db.query("SELECT 1");
  } catch (err) {
    throw new Error(
      `Cannot reach Postgres at ${where} (${describeError(err)}). Set POSTGRES_* in .env, or run without a database with FRAC_STUDIO_STORE=memory.`,
    );
  }
}
