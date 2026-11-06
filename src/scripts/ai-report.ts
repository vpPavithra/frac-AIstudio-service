// `npm run ai:report`: writes the AI response report (services/reports/ai-report.ts) for a period, from
// the ai_calls, jobs and reviews tables in Postgres (POSTGRES_* in .env). Attach it to release notes.
//   npm run ai:report                         last 30 days → reports/ai-report-<today>.md
//   npm run ai:report -- --days 7
//   npm run ai:report -- --since 2026-11-01 --out reports/release-0.2.0-ai.md
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createPool, poolTarget } from "../config/db.ts";
import { checkDatabase } from "../db/check.ts";
import { pgRepositories } from "../repositories/index.ts";
import { buildAiReport } from "../services/reports/ai-report.ts";

/** Default period when neither --days nor --since is given. */
const DEFAULT_DAYS = 30;
const DAY_MS = 86_400_000;

/** `--name value` pairs from the command line. */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const to = new Date();
  const since = arg("since");
  const days = Number(arg("days") ?? DEFAULT_DAYS);
  const from = since ? new Date(`${since}T00:00:00Z`) : new Date(to.getTime() - days * DAY_MS);
  if (Number.isNaN(from.getTime())) {
    process.stderr.write(`✗ --since must be a date like 2026-11-01, got "${since}"\n`);
    return 1;
  }
  const out = path.resolve(arg("out") ?? `reports/ai-report-${to.toISOString().slice(0, 10)}.md`);

  const pool = createPool();
  try {
    await checkDatabase(pool, poolTarget());
    const repos = pgRepositories(pool);
    const [calls, jobs, reviews] = await Promise.all([repos.aiCalls.listSince(from), repos.jobs.listSince(from), repos.reviews.listSince(from)]);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, buildAiReport({ calls, jobs, reviews, from, to, generatedAt: new Date() }));
    process.stdout.write(`✓ ${calls.length} AI calls, ${jobs.length} jobs, ${reviews.length} reviews → ${path.relative(process.cwd(), out)}\n`);
    return 0;
  } finally {
    await pool.end();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
