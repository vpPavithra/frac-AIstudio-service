import "dotenv/config";
import { createPool } from "./config/db.js";
import { loadMigrations, runMigrations } from "./db/migrate.js";

// `npm run migrate` locally, `node migrate.js` in the image (a deploy job or init container).
const pool = createPool();
runMigrations(pool, loadMigrations())
  .then((applied) => {
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date");
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
