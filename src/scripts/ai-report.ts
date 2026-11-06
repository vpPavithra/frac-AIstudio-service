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
//   npm run ai:report:run                          the latest server run, start to stop (or now) → reports/runs/
//   npm run ai:report:run -- --run 12              one given run (ids are in the startup log: "run": 12)
//   npm run ai:report -- --from 2026-11-06T17:30 --to 2026-11-06T19:00   any exact window (report clock)
//   npm run ai:report -- --frac <FRAC id>         the complete flow of one FRAC: every step, revision and expert check
//   providers: REPORT_PROVIDERS (claude) by default; --provider claude,claude-fast to choose, --provider all for every one
//   add --title "…" to name the report
// A daily report always lists every call with its start and finish time.
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPORTS } from "../config/constants.ts";
import { createPool, poolTarget } from "../config/db.ts";
import { checkDatabase } from "../db/check.ts";
import { pgRepositories } from "../repositories/index.ts";
import type { AiCall } from "../models/ai-call.model.ts";
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

/** A date-time on the report clock ("2026-11-06T17:30"), as a UTC instant. */
const atLocal = (s: string) => {
  const full = s.length === 10 ? `${s}T00:00:00` : s.length === 16 ? `${s}:00` : s;
  return new Date(Date.parse(`${full}Z`) - OFFSET_MS);
};
const clock = (d: Date) => new Date(d.getTime() + OFFSET_MS).toISOString().replace("T", " ").slice(0, 16);

/** The whole life of one FRAC: from its first job to its last, with its brief and size in the title. */
async function fracPlan(repos: ReturnType<typeof pgRepositories>, fracId: string): Promise<Plan & { fracId: string }> {
  const frac = await repos.fracs.get(fracId);
  if (!frac) throw new Error(`No FRAC ${fracId}.`);
  const jobs = (await repos.jobs.listSince(new Date(frac.createdAt))).filter((j) => j.targetId === fracId);
  if (!jobs.length) throw new Error(`FRAC ${fracId} has no AI jobs yet.`);
  const from = new Date(Math.min(...jobs.map((j) => Date.parse(j.createdAt))));
  const to = new Date(Math.max(...jobs.map((j) => Date.parse(j.updatedAt))) + 1000);
  const acts = frac.roles.reduce((n, r) => n + r.activities.length, 0);
  return {
    fracId,
    from,
    to,
    out: path.resolve(arg("out") ?? path.join(REPORTS.dir, "fracs", `frac-${fracId.slice(0, 8)}-cost.md`)),
    title: `Cost of one FRAC, complete flow: ${frac.cadre} · ${frac.state} · ${frac.size} (${frac.roles.length} roles, ${acts} activities, ${frac.competencies.length} competencies), ${clock(from)} to ${clock(to)}`,
    listCalls: true,
  };
}

/** The window of one server run: start to stop, or to now while it is still running. */
async function runPlan(repos: ReturnType<typeof pgRepositories>): Promise<Plan> {
  const id = arg("run");
  const run = id && /^\d+$/.test(id) ? await repos.serverRuns.get(Number(id)) : await repos.serverRuns.latest();
  if (!run) throw new Error(id && /^\d+$/.test(id) ? `No server run ${id}.` : "No server run recorded yet: start the service with npm run dev:ai first.");
  const from = new Date(run.startedAt);
  const to = run.stoppedAt ? new Date(run.stoppedAt) : new Date();
  return {
    from,
    to,
    out: path.resolve(arg("out") ?? path.join(REPORTS.dir, "runs", `ai-run-${run.id}-${clock(from).slice(0, 10)}.md`)),
    title: `Server run #${run.id} (${run.provider}): ${clock(from)} to ${run.stoppedAt ? clock(to) : `${clock(to)}, still running`}`,
    listCalls: true,
  };
}

/** Works out the period, output file and options from the command line; throws on a bad date. */
function plan(): Plan {
  const now = new Date();
  if (arg("from")) {
    const from = atLocal(arg("from") as string);
    const to = arg("to") ? atLocal(arg("to") as string) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error(`--from / --to must look like 2026-11-06T17:30, got "${arg("from")}" / "${arg("to")}"`);
    return {
      from,
      to,
      out: path.resolve(arg("out") ?? path.join(REPORTS.dir, `ai-report-${clock(from).slice(0, 10)}.md`)),
      title: `AI response report, ${clock(from)} to ${clock(to)}`,
      listCalls: true,
    };
  }
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

/**
 * Keeps only the calls of the given providers, the jobs that made such calls, and the reviews those jobs
 * produced (uploads by review id, expert checks by FRAC id). Everything when `providers` is empty.
 */
function onlyProviders(providers: string[], calls: AiCall[], jobs: Job[], reviews: ReviewRecord[]) {
  if (!providers.length) return { calls, jobs, reviews };
  const keep = calls.filter((c) => providers.includes(c.provider));
  const jobIds = new Set(keep.map((c) => c.jobId));
  const kept = jobs.filter((j) => jobIds.has(j.id));
  const reviewIds = new Set(kept.filter((j) => j.kind === "review").map((j) => j.targetId));
  const checkedFracs = new Set(kept.filter((j) => j.kind === "check").map((j) => j.targetId));
  return {
    calls: keep,
    jobs: kept,
    reviews: reviews.filter((r) => reviewIds.has(r.id) || (r.kind === "expert-check" && r.fracId !== null && checkedFracs.has(r.fracId))),
  };
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
  const pool = createPool();
  try {
    await checkDatabase(pool, poolTarget());
    const repos = pgRepositories(pool);
    const fracId = arg("frac");
    const p: Plan & { fracId?: string } = fracId ? await fracPlan(repos, fracId) : flag("run") ? await runPlan(repos) : plan();
    if (arg("title")) p.title = arg("title");
    const since = p.previousFrom ?? p.from;
    const chosen = arg("provider") ? (arg("provider") as string).split(",").map((x) => x.trim()).filter(Boolean) : REPORTS.providers;
    const providers = chosen.includes("all") ? [] : chosen;
    const loaded = await Promise.all([repos.aiCalls.listSince(since), repos.jobs.listSince(since), repos.reviews.listSince(p.from)]);
    // One FRAC only: its jobs, their calls, and its expert checks
    if (p.fracId) {
      const ids = new Set(loaded[1].filter((j) => j.targetId === p.fracId).map((j) => j.id));
      loaded[0] = loaded[0].filter((c) => c.jobId !== null && ids.has(c.jobId));
      loaded[1] = loaded[1].filter((j) => ids.has(j.id));
      loaded[2] = loaded[2].filter((r) => r.fracId === p.fracId);
    }
    const { calls: allCalls, jobs: allJobs, reviews } = onlyProviders(providers, ...loaded);
    // Split off the day before, for the daily report's comparison
    const inPrev = (iso: string) => !!p.previousFrom && Date.parse(iso) < p.from.getTime();
    const calls = allCalls.filter((c) => !inPrev(c.startedAt ?? c.createdAt));
    const jobs = allJobs.filter((j) => !inPrev(j.createdAt));
    const previous = p.previousFrom
      ? { label: p.previousLabel ?? "the day before", calls: allCalls.filter((c) => inPrev(c.startedAt ?? c.createdAt)), jobs: allJobs.filter((j) => inPrev(j.createdAt)) }
      : undefined;
    mkdirSync(path.dirname(p.out), { recursive: true });
    const targets = await targetNames(repos, jobs, reviews);
    const md = buildAiReport({ calls, jobs, reviews, from: p.from, to: p.to, generatedAt: new Date(), utcOffsetMinutes: REPORTS.utcOffsetMinutes, listCalls: p.listCalls, title: p.title, targets, dailyBudgetUsd: REPORTS.dailyBudgetUsd, previous, providers });
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
