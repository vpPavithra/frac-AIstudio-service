// The AI response report: how the AI answered over a period, as Markdown for release notes. Pure: it gets
// the per-call log (ai_calls), the jobs and the reviews and returns text. scripts/ai-report.ts reads them
// from Postgres and writes the file (`npm run ai:report`).
// Sections: summary, by provider and model, by task, call errors, jobs, the review checklist, findings.
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
}

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
  const total = (k: keyof AiChecklistStats) => sum(stats.map((s) => s[k]));
  const raised = total("scopeRaised") + total("accuracyRaised");
  const rows = [
    ["Reviews with checklist counts", String(stats.length)],
    ["Competencies sent to the checklist", int(total("competenciesAsked"))],
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

/** The whole report as Markdown. */
export function buildAiReport(input: AiReportInput): string {
  const { calls, jobs, reviews } = input;
  const estimated = calls.some((c) => c.estimated);
  return [
    `# AI response report, ${day(input.from)} to ${day(input.to)}`,
    "",
    `Generated ${input.generatedAt.toISOString().replace("T", " ").slice(0, 16)} UTC by \`npm run ai:report\`. No prompt or answer text is stored or shown.`,
    "",
    "## Summary",
    "",
    summary(calls, jobs),
    ...(estimated ? ["", "Costs marked est. are estimates at list prices (the mock, or a free-tier key), not a bill."] : []),
    ...(calls.some((c) => c.provider === "mock") ? ["", "Calls from `mock` are sample data: their tokens and times say nothing about a real model."] : []),
    "",
    "## By provider and model",
    "",
    calls.length ? table(["Provider · model", ...CALL_HEAD.slice(1)], callRows(groupBy(calls, (c) => `${c.provider} · ${c.model || "(no answer)"}`))) : "No calls.",
    "",
    "## By task",
    "",
    calls.length ? table(["Task", ...CALL_HEAD.slice(1)], callRows(groupBy(calls, (c) => c.task))) : "No calls.",
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
  ].join("\n");
}
