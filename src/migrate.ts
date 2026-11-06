// Standalone migration command: applies every pending migrations/*.sql file once, then exits.
// Uses the same POSTGRES_* env vars as the service (config/db.ts) and the runner in db/migrate.ts.
// Exit code 1 on failure, so a deploy job or init container stops the rollout.
import "dotenv/config";
import { createPool } from "./config/db.ts";
import { loadMigrations, runMigrations } from "./db/migrate.ts";
import { describeError, logger } from "./utils/logger.ts";

// `npm run migrate` locally; `node migrate.js` in the image (a deploy job or init container; dist/ is copied flat).
const pool = createPool();
runMigrations(pool, loadMigrations())
  .then((applied) => {
    logger.info(applied.length ? "Applied migrations" : "Database is up to date", { applied });
  })
  .catch((err: unknown) => {
    logger.error("Migration failed", { error: describeError(err) });
    process.exitCode = 1;
  })
  .finally(() => pool.end());
