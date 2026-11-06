// `npm run ai:report` and `npm run ai:report:daily`: write the AI response report
// (services/reports/ai-report.ts) from the ai_calls, jobs and reviews tables in Postgres (POSTGRES_* in .env).
// Days and times use REPORT_UTC_OFFSET_MINUTES (IST by default); files go under REPORT_DIR (reports/).
//
//   npm run ai:report                              last 30 days → reports/ai-report-<today>.md
//   npm run ai:report -- --days 7 --calls          last 7 days, with the every-call table
//   npm run ai:report -- --since 2026-11-01 --out reports/release-0.2.0-ai.md
//   npm run ai:report:daily                        today so far → reports/daily/ai-daily-<today>.md
//   npm run ai:report:daily -- --yesterday         the whole of yesterday (for a cron job after midnight)
//   npm run ai:report:daily -- --day 2026-11-06    one given day
// A daily report always lists every call with its start and finish time.
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPORTS } from "../config/constants.ts";
import { createPool, poolTarget } from "../config/db.ts";
import { checkDatabase } from "../db/check.ts";
import { pgRepositories } from "../repositories/index.ts";
import type { Job } from "../models/job.model.ts";
import type { ReviewRecord } from "../models/review.model.ts";
import { buildAiReport } from "../services/reports/ai-report.ts";

/** Default period when neither --days nor --since is given. */
const DEFAULT_DAYS = 30;
const DAY_MS = 86_400_000;
const OFFSET_MS = REPORTS.utcOffsetMinutes * 60_000;

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

/** Midnight at the start of `yyyy-mm-dd` on the report clock, as a UTC instant. */
const startOfDay = (yyyyMmDd: string) => new Date(Date.parse(`${yyyyMmDd}T00:00:00Z`) - OFFSET_MS);
/** Today's date on the report clock. */
const localToday = () => new Date(Date.now() + OFFSET_MS).toISOString().slice(0, 10);

interface Plan {
  from: Date;
  to: Date;
  out: string;
  title?: string;
  listCalls: boolean;
  /** The daily report compares with the day before; the start of that day. */
  previousFrom?: Date;
  previousLabel?: string;
}

/** Works out the period, output file and options from the command line; throws on a bad date. */
function plan(): Plan {
  const now = new Date();
  if (flag("daily")) {
    const today = localToday();
    const dayStr = arg("day") ?? (flag("yesterday") ? new Date(startOfDay(today).getTime() - 1 + OFFSET_MS).toISOString().slice(0, 10) : today);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayStr) || Number.isNaN(startOfDay(dayStr).getTime())) throw new Error(`--day must be a date like 2026-11-06, got "${dayStr}"`);
    const from = startOfDay(dayStr);
    const to = new Date(Math.min(from.getTime() + DAY_MS, now.getTime()));
    return {
      from,
      to,
      out: path.resolve(arg("out") ?? path.join(REPORTS.dir, "daily", `ai-daily-${dayStr}.md`)),
      title: `Daily AI report, ${dayStr}${dayStr === today ? " (so far)" : ""}`,
      listCalls: true,
      previousFrom: new Date(from.getTime() - DAY_MS),
      previousLabel: new Date(from.getTime() - DAY_MS + OFFSET_MS).toISOString().slice(0, 10),
    };
  }
  const since = arg("since");
  const from = since ? startOfDay(since) : new Date(now.getTime() - Number(arg("days") ?? DEFAULT_DAYS) * DAY_MS);
  if (Number.isNaN(from.getTime())) throw new Error(`--since must be a date like 2026-11-01, got "${since}"`);
  return { from, to: now, out: path.resolve(arg("out") ?? path.join(REPORTS.dir, `ai-report-${localToday()}.md`)), listCalls: flag("calls") };
}

/** "FRAC ANM · Bihar · standard" or "Review Meghalaya ANM.xlsx" for each job target in the period. */
async function targetNames(repos: ReturnType<typeof pgRepositories>, jobs: Job[], reviews: ReviewRecord[]): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  for (const r of reviews) names[r.id] = `Review ${r.sourceName || r.id.slice(0, 8)}`;
  const fracIds = [...new Set(jobs.filter((j) => j.kind !== "review" && j.targetId).map((j) => j.targetId as string))];
  for (const id of fracIds) {
    const f = await repos.fracs.get(id);
    if (f) names[id] = `FRAC ${f.cadre} · ${f.state} · ${f.size}`;
  }
  return names;
}

async function main(): Promise<number> {
  const p = plan();
  const pool = createPool();
  try {
    await checkDatabase(pool, poolTarget());
    const repos = pgRepositories(pool);
    const since = p.previousFrom ?? p.from;
    const [allCalls, allJobs, reviews] = await Promise.all([repos.aiCalls.listSince(since), repos.jobs.listSince(since), repos.reviews.listSince(p.from)]);
    // Split off the day before, for the daily report's comparison
    const inPrev = (iso: string) => !!p.previousFrom && Date.parse(iso) < p.from.getTime();
    const calls = allCalls.filter((c) => !inPrev(c.startedAt ?? c.createdAt));
    const jobs = allJobs.filter((j) => !inPrev(j.createdAt));
    const previous = p.previousFrom
      ? { label: p.previousLabel ?? "the day before", calls: allCalls.filter((c) => inPrev(c.startedAt ?? c.createdAt)), jobs: allJobs.filter((j) => inPrev(j.createdAt)) }
      : undefined;
    mkdirSync(path.dirname(p.out), { recursive: true });
    const targets = await targetNames(repos, jobs, reviews);
    const md = buildAiReport({ calls, jobs, reviews, from: p.from, to: p.to, generatedAt: new Date(), utcOffsetMinutes: REPORTS.utcOffsetMinutes, listCalls: p.listCalls, title: p.title, targets, dailyBudgetUsd: REPORTS.dailyBudgetUsd, previous });
    writeFileSync(p.out, md);
    const inPeriod = calls.filter((c) => Date.parse(c.startedAt ?? c.createdAt) < p.to.getTime()).length;
    process.stdout.write(`✓ ${inPeriod} AI calls → ${path.relative(process.cwd(), p.out)}\n`);
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
