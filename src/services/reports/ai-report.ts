// The AI response report: how the AI answered over a period, as Markdown for release notes. Pure: it gets
// the per-call log (ai_calls), the jobs and the reviews and returns text. scripts/ai-report.ts reads them
// from Postgres and writes the file (`npm run ai:report`).
// Sections: summary, by day, by provider and model, by task, call errors, jobs, the review checklist,
// findings, and (when asked, always for a daily report) every call with its start and finish time.
// Days and times are on the REPORT_UTC_OFFSET_MINUTES clock (IST by default).
import type { AiCall } from "../../models/ai-call.model.ts";
import type { Job } from "../../models/job.model.ts";
import type { AiChecklistStats } from "../../models/report.model.ts";
import type { ReviewRecord } from "../../models/review.model.ts";

export interface AiReportInput {
  calls: AiCall[];
  jobs: Job[];
  reviews: ReviewRecord[];
  from: Date;
  to: Date;
  generatedAt: Date;
  /** Minutes ahead of UTC for days and times (330 = IST). */
  utcOffsetMinutes?: number;
  /** Add the "Every call" table. */
  listCalls?: boolean;
  /** Title override, e.g. "Daily AI report, 2026-11-06". */
  title?: string;
  /** A readable name per job target id (FRAC or review), e.g. "FRAC ANM · Bihar · standard". */
  targets?: Record<string, string>;
  /** Billed USD per day above which the report warns; 0 or absent = no warning. */
  dailyBudgetUsd?: number;
  /** Set when the report covers only some providers (npm run ai:report -- --provider claude); shown under the title. */
  providers?: string[];
  /** The period before, for the "Compared with" table (the daily report passes the previous day). */
  previous?: { label: string; calls: AiCall[]; jobs: Job[] };
}

/** Order the steps appear in the "By step" table: the Creator flow, then the Reviewer. */
const STEP_ORDER = ["research", "roles", "competencies", "ladders", "check", "review"];
const STEP_NAME: Record<string, string> = {
  research: "2 Research",
  roles: "3 Roles and activities",
  competencies: "4 Competencies",
  ladders: "5 Level ladders",
  check: "6 Expert check",
  review: "Reviewer upload",
};
/** How many of the slowest calls to list. */
const SLOWEST = 10;

/** What each failed-call outcome means, in the words the release notes use. */
const OUTCOME_MEANING: Record<string, string> = {
  invalid: "Answered, but not in the shape the step needs (the job fails with AI_OUTPUT_INVALID)",
  AI_BUSY: "Rate limit or quota used up",
  AI_AUTH: "Key rejected",
  AI_REFUSED: "The model declined",
  AI_OUTPUT_TRUNCATED: "The answer was cut off at the token limit",
  AI_REQUEST_REJECTED: "The API rejected the request (bad model id or parameters)",
  AI_UNAVAILABLE: "The API was down or timed out",
  ERROR: "Any other error (network, timeout)",
};

const day = (d: Date) => d.toISOString().slice(0, 10);
/** A UTC instant shifted onto the report clock, so toISOString shows local date and time. */
const shift = (iso: string, offsetMin: number) => new Date(Date.parse(iso) + offsetMin * 60_000);
const clockLabel = (offsetMin: number) => {
  if (offsetMin === 330) return "IST";
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
};
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** The value below which 95% of the values fall (nearest rank). */
const p95 = (xs: number[]) => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
};

/** "$1.2345", with "est. " in front when any of the costs is an estimate (mock or free tier). */
const usd = (calls: AiCall[]) => `${calls.some((c) => c.estimated) ? "est. " : ""}$${sum(calls.map((c) => c.costUsd)).toFixed(4)}`;

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return out;
}

const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

/** One table row per group of calls: count, ok rate, failures, latency, tokens, cost. */
function callRows(groups: Map<string, AiCall[]>): string[][] {
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, cs]) => {
      const ok = cs.filter((c) => c.outcome === "ok").length;
      const latency = cs.map((c) => c.latencyMs);
      return [
        name,
        String(cs.length),
        pct(ok, cs.length),
        String(cs.filter((c) => c.outcome === "invalid").length),
        String(cs.filter((c) => c.outcome !== "ok" && c.outcome !== "invalid").length),
        secs(avg(latency)),
        secs(p95(latency)),
        int(avg(cs.map((c) => c.inputTokens))),
        int(avg(cs.map((c) => c.outputTokens))),
        usd(cs),
      ];
    });
}

const CALL_HEAD = ["", "Calls", "Answered OK", "Wrong shape", "Errors", "Avg time", "p95 time", "Avg tokens in", "Avg tokens out", "Cost"];

function summary(calls: AiCall[], jobs: Job[]): string {
  if (!calls.length) {
    return "No AI calls were recorded in this period. Run the service with a provider (`npm run dev:ai` or `npm run dev:mock`) and some steps or reviews first.";
  }
  const ok = calls.filter((c) => c.outcome === "ok").length;
  const providers = [...new Set(calls.map((c) => c.provider))].join(", ");
  const failedJobs = jobs.filter((j) => j.status === "error").length;
  return [
    `${int(calls.length)} AI calls through ${providers}: ${pct(ok, calls.length)} answered in the expected shape,`,
    `average ${secs(avg(calls.map((c) => c.latencyMs)))} per call, ${int(sum(calls.map((c) => c.inputTokens)))} tokens in and`,
    `${int(sum(calls.map((c) => c.outputTokens)))} out, ${usd(calls)} in total. ${jobs.length} jobs ran; ${failedJobs} failed.`,
  ].join(" ");
}

function errorsSection(calls: AiCall[]): string {
  const failed = calls.filter((c) => c.outcome !== "ok");
  if (!failed.length) return "No call failed or came back in the wrong shape.";
  const rows = [...groupBy(failed, (c) => c.outcome).entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([code, cs]) => [`\`${code}\``, String(cs.length), [...new Set(cs.map((c) => c.task))].join(", "), OUTCOME_MEANING[code] ?? ""]);
  return table(["Outcome", "Calls", "Tasks", "Meaning"], rows);
}

function jobsSection(jobs: Job[]): string {
  if (!jobs.length) return "No jobs in this period.";
  const rows = [...groupBy(jobs, (j) => j.kind).entries()].map(([kind, js]) => {
    const failed = js.filter((j) => j.status === "error");
    const codes = [...groupBy(failed, (j) => j.errorCode ?? "unknown").entries()].map(([code, x]) => `${code} ×${x.length}`).join(", ");
    const durations = js.filter((j) => j.status === "done").map((j) => Date.parse(j.updatedAt) - Date.parse(j.createdAt));
    return [
      kind,
      String(js.length),
      String(js.filter((j) => j.status === "done").length),
      failed.length ? `${failed.length} (${codes})` : "0",
      durations.length ? secs(avg(durations)) : "–",
      (avg(js.map((j) => j.usage.calls ?? 0)) || 0).toFixed(1),
      `${js.some((j) => j.usage.estimated) ? "est. " : ""}$${avg(js.map((j) => j.usage.costUsd ?? 0)).toFixed(4)}`,
    ];
  });
  return table(["Job", "Runs", "Done", "Failed (codes)", "Avg time (done)", "Avg AI calls", "Avg cost"], rows);
}

function checklistSection(reviews: ReviewRecord[]): string {
  const stats = reviews.map((r) => r.report?.aiChecklist).filter((s): s is AiChecklistStats => !!s);
  if (!stats.length) return "No review in this period recorded checklist counts.";
  type Counted = Exclude<keyof AiChecklistStats, "stateReused" | "reusedCompetencies">;
  const total = (k: Counted) => sum(stats.map((s) => s[k]));
  const raised = total("scopeRaised") + total("accuracyRaised");
  const rows = [
    ["Reviews with checklist counts", String(stats.length)],
    ["Competencies sent to the checklist", int(total("competenciesAsked"))],
    ["of which reused a stored answer (unchanged)", int(sum(stats.map((s) => s.reusedCompetencies ?? 0)))],
    ["Scope flags raised (Q1)", int(total("scopeRaised"))],
    ["Accuracy flags raised (Q2)", int(total("accuracyRaised"))],
    ["Kept after the quote check", `${int(total("kept"))} (${pct(total("kept"), raised)})`],
    ["Dropped: quote not in the file", `${int(total("droppedQuoteNotFound"))} (${pct(total("droppedQuoteNotFound"), raised)})`],
    ["Dropped: a rule already covers it", `${int(total("droppedCoveredByRule"))} (${pct(total("droppedCoveredByRule"), raised)})`],
    ["Dropped: duplicate of a scope rule hit", `${int(total("droppedDuplicateScope"))} (${pct(total("droppedDuplicateScope"), raised)})`],
    ["State-fit items raised / kept (Q3)", `${int(total("stateRaised"))} / ${int(total("stateKept"))}`],
  ];
  return [
    table(["Measure", "Value"], rows),
    "",
    "A high \"quote not in the file\" share means the model is describing problems the workbook does not contain;",
    "the quote check removes those before they reach a finding.",
  ].join("\n");
}

function findingsSection(reviews: ReviewRecord[]): string {
  const reports = reviews.map((r) => r.report).filter((r) => !!r);
  if (!reports.length) return "No finished reviews in this period.";
  const findings = reports.flatMap((r) => r.findings);
  const bySource = (src: string, sev: string) => String(findings.filter((f) => f.source === src && f.sev === sev).length);
  const triage = groupBy(reports, (r) => r.triage);
  return [
    table(
      ["Found by", "Blocker", "Major", "Minor"],
      [
        ["Rule-based check", bySource("computed", "B"), bySource("computed", "M"), bySource("computed", "m")],
        ["AI judgement (quoted)", bySource("agent", "B"), bySource("agent", "M"), bySource("agent", "m")],
      ],
    ),
    "",
    `Triage across ${reports.length} reviews: ${[...triage.entries()].map(([t, rs]) => `${t} ${rs.length}`).join(", ")}.`,
  ].join("\n");
}

/**
 * Tokens, cost and time per step, from the per-call log: how many times the step ran, its calls, and the
 * per-run averages, one row per step and provider (a day can mix the mock, Gemini and Claude). A step's runs
 * include revisions, so per-run figures are what one click costs.
 */
function byStepSection(calls: AiCall[], jobs: Job[]): string {
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const steps = groupBy(
    calls.filter((c) => c.jobKind),
    (c) => `${c.jobKind}|${c.provider}`,
  );
  if (!steps.size) return "No calls belonged to a step in this period.";
  const order = (k: string) => (STEP_ORDER.includes(k) ? STEP_ORDER.indexOf(k) : STEP_ORDER.length);
  const rows = [...steps.entries()]
    .sort((a, b) => order(a[0].split("|")[0]) - order(b[0].split("|")[0]) || a[0].localeCompare(b[0]))
    .map(([key, cs]) => {
      const [kind, provider] = key.split("|");
      const runIds = new Set(cs.map((c) => c.jobId));
      const runs = runIds.size || 1;
      // Wall time: from the job's start to its last update, finished jobs only (what the user waited)
      const walls = [...runIds]
        .map((id) => (id ? jobById.get(id) : undefined))
        .filter((j): j is Job => !!j && j.status === "done")
        .map((j) => Date.parse(j.updatedAt) - Date.parse(j.createdAt));
      // Thinking share: only calls whose provider reported thinking tokens
      const measured = cs.filter((c) => c.thinkingTokens !== null && c.thinkingTokens !== undefined);
      const thinkShare = measured.length ? pct(sum(measured.map((c) => c.thinkingTokens ?? 0)), sum(measured.map((c) => c.outputTokens))) : "–";
      const tin = sum(cs.map((c) => c.inputTokens));
      const tout = sum(cs.map((c) => c.outputTokens));
      const cost = sum(cs.map((c) => c.costUsd));
      const est = cs.some((c) => c.estimated) ? "est. " : "";
      return [
        STEP_NAME[kind] ?? kind,
        provider,
        String(runs),
        String(cs.length),
        int(tin),
        int(tout),
        int(tin / runs),
        int(tout / runs),
        `${est}$${cost.toFixed(4)}`,
        `${est}$${(cost / runs).toFixed(4)}`,
        secs(sum(cs.map((c) => c.latencyMs)) / runs),
        walls.length ? secs(avg(walls)) : "–",
        thinkShare,
        String(sum(cs.map((c) => c.webSearches))),
      ];
    });
  const all = calls.filter((c) => c.jobKind);
  return [
    table(["Step", "Provider", "Runs", "Calls", "Tokens in", "Tokens out", "Tokens in per run", "Tokens out per run", "Cost", "Cost per run", "Model time per run", "Wall time per run", "Thinking share", "Web searches"], rows),
    "",
    `All steps: ${int(sum(all.map((c) => c.inputTokens)))} tokens in, ${int(sum(all.map((c) => c.outputTokens)))} out, ${usd(all)}.`,
    "Model time per run adds up every call's time; calls run in parallel, so wall time (what the user waited, finished runs only) can be shorter. Thinking share is the part of the output the model spent thinking (\"–\" when not measured); a high share is where lower effort saves most.",
  ].join("\n");
}

/** What each FRAC and each review upload cost in total, across every step and revision in the period. */
function perTargetSection(calls: AiCall[], jobs: Job[], targets: Record<string, string>): string {
  const jobTarget = new Map(jobs.map((j) => [j.id, j.targetId]));
  const withTarget = calls.filter((c) => c.jobId && jobTarget.get(c.jobId));
  if (!withTarget.length) return "No calls belonged to a FRAC or a review in this period.";
  const rows = [...groupBy(withTarget, (c) => jobTarget.get(c.jobId as string) as string).entries()]
    .sort((a, b) => sum(b[1].map((c) => c.costUsd)) - sum(a[1].map((c) => c.costUsd)))
    .map(([target, cs]) => {
      const kinds = STEP_ORDER.filter((k) => cs.some((c) => c.jobKind === k)).map((k) => STEP_NAME[k].replace(/^\d /, ""));
      return [
        targets[target] ?? `\`${target.slice(0, 8)}\``,
        kinds.join(", "),
        String(cs.length),
        int(sum(cs.map((c) => c.inputTokens))),
        int(sum(cs.map((c) => c.outputTokens))),
        usd(cs),
        String(cs.filter((c) => c.outcome !== "ok").length),
      ];
    });
  return table(["FRAC or review", "Steps run", "Calls", "Tokens in", "Tokens out", "Cost", "Calls not OK"], rows);
}

/** The slowest calls, to see which step and model hold a run up. */
function slowestSection(calls: AiCall[], offset: number): string {
  if (!calls.length) return "No calls.";
  const time = (iso: string | null) => (iso ? shift(iso, offset).toISOString().replace("T", " ").slice(5, 19) : "–");
  const rows = [...calls]
    .sort((a, b) => b.latencyMs - a.latencyMs)
    .slice(0, SLOWEST)
    .map((c) => [secs(c.latencyMs), time(c.startedAt ?? c.createdAt), c.task, `${c.provider} · ${c.model || "(no answer)"}`, int(c.outputTokens), c.outcome]);
  return table(["Time", "Started", "Task", "Provider · model", "Tokens out", "Outcome"], rows);
}

/** One table with the period's totals: calls, tokens (in, out, thinking, all), web searches, cost and the billed part. */
function totalsSection(calls: AiCall[]): string {
  if (!calls.length) return "No calls.";
  const tin = sum(calls.map((c) => c.inputTokens));
  const tout = sum(calls.map((c) => c.outputTokens));
  const measured = calls.filter((c) => c.thinkingTokens !== null && c.thinkingTokens !== undefined);
  const thinking = sum(measured.map((c) => c.thinkingTokens ?? 0));
  const cost = sum(calls.map((c) => c.costUsd));
  const real = billed(calls);
  const rows = [
    ["AI calls", int(calls.length)],
    ["Answered OK", `${int(calls.filter((c) => c.outcome === "ok").length)} (${pct(calls.filter((c) => c.outcome === "ok").length, calls.length)})`],
    ["Tokens in", int(tin)],
    ["Tokens out", int(tout)],
    ["of which thinking", measured.length ? `${int(thinking)} (${pct(thinking, sum(measured.map((c) => c.outputTokens)))} of measured output)` : "not measured"],
    ["Total tokens", int(tin + tout)],
    ["Web searches", int(sum(calls.map((c) => c.webSearches)))],
    ["Total cost", `$${cost.toFixed(4)}`],
    ["Billed (real spend)", `$${real.toFixed(4)}`],
    ["Estimated (mock or free tier, not billed)", `$${(cost - real).toFixed(4)}`],
  ];
  return table(["Total", "Value"], rows);
}

/** Real spend only: estimates (the mock, a free-tier key) are not a bill. */
const billed = (calls: AiCall[]) => sum(calls.filter((c) => !c.estimated).map((c) => c.costUsd));

/**
 * Who used the AI: one row per job owner (the user id the uiproxy sends), with what they ran and what it
 * cost. For chargeback or quotas per team.
 */
function byUserSection(calls: AiCall[], jobs: Job[]): string {
  const owner = new Map(jobs.map((j) => [j.id, j.ownerId]));
  const mine = calls.filter((c) => c.jobId && owner.get(c.jobId));
  if (!mine.length) return "No calls belonged to a user's job in this period.";
  const jobsBy = groupBy(jobs, (j) => j.ownerId);
  const rows = [...groupBy(mine, (c) => owner.get(c.jobId as string) as string).entries()]
    .sort((a, b) => sum(b[1].map((c) => c.costUsd)) - sum(a[1].map((c) => c.costUsd)))
    .map(([user, cs]) => {
      const js = jobsBy.get(user) ?? [];
      const fracs = new Set(js.filter((j) => j.kind !== "review" && j.targetId).map((j) => j.targetId)).size;
      return [
        `\`${user}\``,
        String(fracs),
        String(js.filter((j) => j.kind === "review").length),
        String(js.length),
        String(cs.length),
        int(sum(cs.map((c) => c.inputTokens))),
        int(sum(cs.map((c) => c.outputTokens))),
        usd(cs),
        `$${billed(cs).toFixed(4)}`,
      ];
    });
  return table(["User", "FRACs", "Reviews", "Jobs", "Calls", "Tokens in", "Tokens out", "Cost", "Billed"], rows);
}

/**
 * Revisions: the first run of a step on a FRAC versus every later run of it (revise with feedback, rewrite,
 * fix these competencies, or a re-run after a failure), and what the later runs added to the cost.
 */
function revisionsSection(calls: AiCall[], jobs: Job[]): string {
  const stepJobs = jobs.filter((j) => j.targetId && STEP_ORDER.includes(j.kind)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!stepJobs.length) return "No steps ran in this period.";
  const firstRun = new Set<string>();
  const seen = new Set<string>();
  for (const j of stepJobs) {
    const key = `${j.targetId}|${j.kind}`;
    if (!seen.has(key)) firstRun.add(j.id);
    seen.add(key);
  }
  const costOf = (ids: Set<string>) => calls.filter((c) => c.jobId && ids.has(c.jobId));
  const rows = STEP_ORDER.filter((k) => stepJobs.some((j) => j.kind === k)).map((kind) => {
    const js = stepJobs.filter((j) => j.kind === kind);
    const first = new Set(js.filter((j) => firstRun.has(j.id)).map((j) => j.id));
    const again = new Set(js.filter((j) => !firstRun.has(j.id)).map((j) => j.id));
    const firstCalls = costOf(first);
    const againCalls = costOf(again);
    const total = sum(firstCalls.map((c) => c.costUsd)) + sum(againCalls.map((c) => c.costUsd));
    return [
      STEP_NAME[kind],
      String(first.size),
      String(again.size),
      first.size ? (again.size / first.size).toFixed(2) : "–",
      firstCalls.length ? usd(firstCalls) : "–",
      againCalls.length ? usd(againCalls) : "$0.0000",
      pct(sum(againCalls.map((c) => c.costUsd)), total),
    ];
  });
  return [
    table(["Step", "First runs", "Later runs", "Later runs per FRAC", "Cost of first runs", "Cost of later runs", "Later runs' share of cost"], rows),
    "",
    "A later run is any run of the same step on the same FRAC after the first: a revise, a rewrite, \"Fix these competencies\", or a re-run after a failure.",
  ].join("\n");
}

/** Days whose billed spend passed the daily budget, as warning lines for the top of the report. */
function budgetWarnings(calls: AiCall[], offset: number, budget: number): string[] {
  if (!budget) return [];
  const byDay = groupBy(calls, (c) => day(shift(c.startedAt ?? c.createdAt, offset)));
  return [...byDay.entries()]
    .filter(([, cs]) => billed(cs) > budget)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, cs]) => `**Over the daily budget of $${budget.toFixed(2)}:** ${d} billed $${billed(cs).toFixed(2)}.`);
}

/** This period against the one before: the headline measures side by side, with the change. */
function comparedSection(calls: AiCall[], jobs: Job[], prev: { label: string; calls: AiCall[]; jobs: Job[] }): string {
  const measures = (cs: AiCall[], js: Job[]) => ({
    calls: cs.length,
    ok: cs.length ? (cs.filter((c) => c.outcome === "ok").length / cs.length) * 100 : 0,
    notOk: cs.filter((c) => c.outcome !== "ok").length,
    avgS: avg(cs.map((c) => c.latencyMs)) / 1000,
    tokens: sum(cs.map((c) => c.inputTokens + c.outputTokens)),
    cost: sum(cs.map((c) => c.costUsd)),
    billed: billed(cs),
    failedJobs: js.filter((j) => j.status === "error").length,
  });
  const now = measures(calls, jobs);
  const was = measures(prev.calls, prev.jobs);
  const change = (a: number, b: number, fmt: (n: number) => string) => {
    const d = a - b;
    if (Math.abs(d) < 1e-9) return "no change";
    const rel = b ? ` (${d > 0 ? "+" : ""}${Math.round((d / b) * 100)}%)` : "";
    return `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}${rel}`;
  };
  const n = (x: number) => int(x);
  const money = (x: number) => `$${x.toFixed(4)}`;
  const p1 = (x: number) => `${x.toFixed(0)} pts`;
  const s1 = (x: number) => `${x.toFixed(1)} s`;
  const rows: string[][] = [
    ["AI calls", n(was.calls), n(now.calls), change(now.calls, was.calls, n)],
    ["Answered OK", was.calls ? `${was.ok.toFixed(0)}%` : "–", now.calls ? `${now.ok.toFixed(0)}%` : "–", was.calls && now.calls ? change(now.ok, was.ok, p1).replace(/ \(.*\)$/, "") : "–"],
    ["Calls not OK", n(was.notOk), n(now.notOk), change(now.notOk, was.notOk, n)],
    ["Average time per call", was.calls ? s1(was.avgS) : "–", now.calls ? s1(now.avgS) : "–", was.calls && now.calls ? change(now.avgS, was.avgS, s1) : "–"],
    ["Tokens (in + out)", n(was.tokens), n(now.tokens), change(now.tokens, was.tokens, n)],
    ["Cost (with estimates)", money(was.cost), money(now.cost), change(now.cost, was.cost, money)],
    ["Billed", money(was.billed), money(now.billed), change(now.billed, was.billed, money)],
    ["Failed jobs", n(was.failedJobs), n(now.failedJobs), change(now.failedJobs, was.failedJobs, n)],
  ];
  return table(["Measure", prev.label, "This period", "Change"], rows);
}

/** One row per day on the report clock: calls, answered OK, failures, time, tokens, cost, jobs. */
function byDaySection(calls: AiCall[], jobs: Job[], offset: number): string {
  if (!calls.length && !jobs.length) return "Nothing in this period.";
  const dayOf = (iso: string) => day(shift(iso, offset));
  const callDays = groupBy(calls, (c) => dayOf(c.startedAt ?? c.createdAt));
  const jobDays = groupBy(jobs, (j) => dayOf(j.createdAt));
  const days = [...new Set([...callDays.keys(), ...jobDays.keys()])].sort();
  const rows = days.map((d) => {
    const cs = callDays.get(d) ?? [];
    const js = jobDays.get(d) ?? [];
    return [
      d,
      String(cs.length),
      pct(cs.filter((c) => c.outcome === "ok").length, cs.length),
      String(cs.filter((c) => c.outcome !== "ok").length),
      cs.length ? secs(avg(cs.map((c) => c.latencyMs))) : "–",
      int(sum(cs.map((c) => c.inputTokens))),
      int(sum(cs.map((c) => c.outputTokens))),
      cs.length ? usd(cs) : "–",
      `$${billed(cs).toFixed(4)}`,
      `${js.length} (${js.filter((j) => j.status === "error").length} failed)`,
      [...new Set(cs.map((c) => c.provider))].join(", ") || "–",
    ];
  });
  return table(["Day", "Calls", "Answered OK", "Not OK", "Avg time", "Tokens in", "Tokens out", "Cost", "Billed", "Jobs", "Providers"], rows);
}

/** Every call in order: when it started and finished, which job and task, who answered, how it went. */
function everyCallSection(calls: AiCall[], offset: number): string {
  if (!calls.length) return "No calls.";
  const time = (iso: string | null) => (iso ? shift(iso, offset).toISOString().slice(11, 19) : "–");
  const ordered = [...calls].sort((a, b) => (a.startedAt ?? a.createdAt).localeCompare(b.startedAt ?? b.createdAt));
  const rows = ordered.map((c, i) => [
    String(i + 1),
    time(c.startedAt),
    time(c.createdAt),
    c.jobKind ?? "–",
    c.jobId ? `\`${c.jobId.slice(0, 8)}\`` : "–",
    c.task,
    `${c.provider} · ${c.model || "(no answer)"}`,
    c.outcome === "ok" ? "ok" : `**${c.outcome}**`,
    secs(c.latencyMs),
    int(c.inputTokens),
    int(c.outputTokens),
    `${c.estimated ? "est. " : ""}$${c.costUsd.toFixed(4)}`,
  ]);
  return table(["#", "Started", "Finished", "Job", "Job id", "Task", "Provider · model", "Outcome", "Time", "Tokens in", "Tokens out", "Cost"], rows);
}

/** The whole report as Markdown. */
export function buildAiReport(input: AiReportInput): string {
  const offset = input.utcOffsetMinutes ?? 0;
  // Only what falls inside the period (the repositories read from `from` onwards)
  const before = (iso: string) => Date.parse(iso) < input.to.getTime();
  const calls = input.calls.filter((c) => before(c.startedAt ?? c.createdAt));
  const jobs = input.jobs.filter((j) => before(j.createdAt));
  const reviews = input.reviews.filter((r) => before(r.createdAt));
  const estimated = calls.some((c) => c.estimated);
  const clock = clockLabel(offset);
  const localDay = (d: Date) => day(shift(d.toISOString(), offset));
  return [
    `# ${input.title ?? `AI response report, ${localDay(input.from)} to ${localDay(new Date(input.to.getTime() - 1))}`}`,
    "",
    `Generated ${shift(input.generatedAt.toISOString(), offset).toISOString().replace("T", " ").slice(0, 16)} ${clock} by \`npm run ai:report\`. Times are ${clock}. No prompt or answer text is stored or shown.`,
    ...(input.providers?.length ? ["", `**Providers in this report:** ${input.providers.join(", ")} only. Calls, jobs and reviews from other providers are left out.`] : []),
    "",
    "## Summary",
    "",
    summary(calls, jobs),
    ...budgetWarnings(calls, offset, input.dailyBudgetUsd ?? 0).flatMap((w) => ["", w]),
    "",
    "## Totals",
    "",
    totalsSection(calls),
    ...(estimated ? ["", "Costs marked est. are estimates at list prices (the mock, or a free-tier key), not a bill."] : []),
    ...(calls.some((c) => c.provider === "mock") ? ["", "Calls from `mock` are sample data: their tokens and times say nothing about a real model."] : []),
    "",
    "## By day",
    "",
    byDaySection(calls, jobs, offset),
    "",
    ...(input.previous ? [`## Compared with ${input.previous.label}`, "", comparedSection(calls, jobs, input.previous), ""] : []),
    "## By step: tokens and cost",
    "",
    byStepSection(calls, jobs),
    "",
    "## Per FRAC and review",
    "",
    perTargetSection(calls, jobs, input.targets ?? {}),
    "",
    "## Revisions",
    "",
    revisionsSection(calls, jobs),
    "",
    "## By user",
    "",
    byUserSection(calls, jobs),
    "",
    "## By provider and model",
    "",
    calls.length ? table(["Provider · model", ...CALL_HEAD.slice(1)], callRows(groupBy(calls, (c) => `${c.provider} · ${c.model || "(no answer)"}`))) : "No calls.",
    "",
    "## By task",
    "",
    calls.length ? table(["Task", ...CALL_HEAD.slice(1)], callRows(groupBy(calls, (c) => c.task))) : "No calls.",
    "",
    `## Slowest ${SLOWEST} calls`,
    "",
    slowestSection(calls, offset),
    "",
    "## Calls that failed or came back in the wrong shape",
    "",
    errorsSection(calls),
    "",
    "## Jobs",
    "",
    jobsSection(jobs),
    "",
    "## Review checklist: what the AI raised and what was kept",
    "",
    checklistSection(reviews),
    "",
    "## Findings in the reviews",
    "",
    findingsSection(reviews),
    "",
    ...(input.listCalls ? ["## Every call", "", "Started is when the call was sent to the model; Time is the model's own time (a wait for a free slot is not counted).", "", everyCallSection(calls, offset), ""] : []),
  ].join("\n");
}
