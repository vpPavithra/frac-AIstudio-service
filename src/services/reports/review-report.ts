// The review analysis report: one Markdown report per target, for a Reviewer upload (by review id) or for
// a FRAC's expert checks (by FRAC id). It explains a review: what was reviewed, the verdict and triage and
// why, each check's status, every finding (severity, found by a rule or the AI, the competencies cited), what
// the AI checklist raised, kept and dropped, and what the review cost, call by call. Pure: it gets the
// reviews and their calls and returns text. scripts/review-report.ts reads them (`npm run review:report`).
import type { AiCall } from "../../models/ai-call.model.ts";
import type { Finding, Report, Severity } from "../../models/report.model.ts";
import type { ReviewRecord } from "../../models/review.model.ts";
import { TITLES } from "../review-engine/checks.ts";

/** One review and the model calls that produced its report (and any earlier runs of an upload). */
export interface ReviewAnalysisItem {
  review: ReviewRecord;
  calls: AiCall[];
  /** How many times the review job ran (an upload's "Run a fresh review" replaces the report in place). */
  runs: number;
}

export interface ReviewReportInput {
  /** "review" for a Reviewer upload id, "frac" for a FRAC id (its expert checks). */
  targetKind: "review" | "frac";
  targetId: string;
  /** e.g. "Meghalaya ANM.xlsx" or "FRAC ANM · Arunachal Pradesh · standard". */
  targetName: string;
  /** Oldest first. For a FRAC, one per expert check run. */
  items: ReviewAnalysisItem[];
  generatedAt: Date;
  /** Minutes ahead of UTC for times (330 = IST). */
  utcOffsetMinutes?: number;
}

const SEV_NAME: Record<Severity, string> = { B: "Blocker", M: "Major", m: "Minor" };
const SEV_ORDER: Severity[] = ["B", "M", "m"];
const TRIAGE_NAME: Record<Report["triage"], string> = { use: "Use with minor edits", revise: "Revise", rebuild: "Rebuild from the job" };
/** Longest finding detail printed in the findings table; the full text follows in the details. */
const DETAIL_CHARS = 160;

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const usd = (calls: AiCall[]) => `${calls.some((c) => c.estimated) ? "est. " : ""}$${sum(calls.map((c) => c.costUsd)).toFixed(4)}`;
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
const at = (iso: string, offset: number) => new Date(Date.parse(iso) + offset * 60_000).toISOString().replace("T", " ").slice(0, 19);
const foundBy = (f: Finding) => (f.source === "agent" ? "AI judgement (quoted)" : "Rule-based check");

/** Why the triage is what it is, in the r3 §7 terms the code applies. */
function triageReason(report: Report): string {
  const titles = report.findings.map((f) => f.title);
  const blockers = report.findings.filter((f) => f.sev === "B").length;
  const majors = report.findings.filter((f) => f.sev === "M").length;
  if (report.triage === "rebuild") {
    const why = [
      titles.includes(TITLES.syllabus) ? `the finding "${TITLES.syllabus}" is raised (any severity forces a rebuild under r3 §7)` : "",
      titles.includes(TITLES.untyped) ? "no competency is typed" : "",
      titles.includes(TITLES.incomplete) ? "more than half the laddered competencies have incomplete ladders" : "",
    ].filter(Boolean);
    return `Rebuild because ${why.join("; ") || "a rebuild condition of r3 §7 holds"}.`;
  }
  if (report.triage === "revise") return `Revise because there ${blockers === 1 ? "is 1 blocker" : `are ${blockers} blockers`} and ${majors} major findings (any blocker, or 3 or more majors).`;
  return "Use with minor edits: no blocker and fewer than 3 major findings.";
}

/** Counts by severity and by who found them. */
function countsTable(findings: Finding[]): string {
  const rows = (["computed", "agent"] as const).map((src) => [
    src === "agent" ? "AI judgement (quoted)" : "Rule-based check",
    ...SEV_ORDER.map((s) => String(findings.filter((f) => f.source === src && f.sev === s).length)),
    String(findings.filter((f) => f.source === src).length),
  ]);
  rows.push(["All", ...SEV_ORDER.map((s) => String(findings.filter((f) => f.sev === s).length)), String(findings.length)]);
  return table(["Found by", "Blocker", "Major", "Minor", "Total"], rows);
}

/** What the AI checklist raised and what survived the quote check (rules r3 §6.3). */
function checklistTable(report: Report): string {
  const s = report.aiChecklist;
  if (!s) return "Not recorded for this review (it ran before checklist counts were stored).";
  const raised = s.scopeRaised + s.accuracyRaised;
  return table(
    ["Measure", "Value"],
    [
      ["Competencies sent to the checklist", int(s.competenciesAsked)],
      ["Scope flags raised (Q1)", int(s.scopeRaised)],
      ["Accuracy flags raised (Q2)", int(s.accuracyRaised)],
      ["Kept after the quote check", `${int(s.kept)} (${pct(s.kept, raised)})`],
      ["Dropped: quote not in the file", `${int(s.droppedQuoteNotFound)} (${pct(s.droppedQuoteNotFound, raised)})`],
      ["Dropped: a rule already covers it", int(s.droppedCoveredByRule)],
      ["Dropped: duplicate of a scope rule hit", int(s.droppedDuplicateScope)],
      ["State-fit items raised / kept (Q3)", `${int(s.stateRaised)} / ${int(s.stateKept)}`],
    ],
  );
}

/** Cost of producing this review: totals, then every call. */
function costSection(item: ReviewAnalysisItem, offset: number): string {
  const cs = [...item.calls].sort((a, b) => (a.startedAt ?? a.createdAt).localeCompare(b.startedAt ?? b.createdAt));
  if (!cs.length) return "No model calls are linked to this review (it ran before calls were logged, or it was served from the saved review).";
  const totals = table(
    ["Total", "Value"],
    [
      ["Runs of the review job", String(item.runs)],
      ["AI calls", `${cs.length} (${cs.filter((c) => c.outcome === "ok").length} answered OK)`],
      ["Tokens in / out", `${int(sum(cs.map((c) => c.inputTokens)))} / ${int(sum(cs.map((c) => c.outputTokens)))}`],
      ["Total tokens", int(sum(cs.map((c) => c.inputTokens + c.outputTokens)))],
      ["Cost", usd(cs)],
      ["Provider · model", [...new Set(cs.map((c) => `${c.provider} · ${c.model || "(no answer)"}`))].join(", ")],
    ],
  );
  const rows = cs.map((c, i) => [
    String(i + 1),
    at(c.startedAt ?? c.createdAt, offset).slice(11),
    c.task,
    c.outcome,
    secs(c.latencyMs),
    int(c.inputTokens),
    int(c.outputTokens),
    `${c.estimated ? "est. " : ""}$${c.costUsd.toFixed(4)}`,
  ]);
  return [totals, "", table(["#", "Started", "Task", "Outcome", "Time", "Tokens in", "Tokens out", "Cost"], rows)].join("\n");
}

/** The full analysis of one review. */
function reviewSection(item: ReviewAnalysisItem, offset: number, heading: string): string[] {
  const { review } = item;
  const report = review.report;
  if (!report) return [heading, "", "This review has no report yet (its job is still running or failed).", ""];
  const findings = [...report.findings];
  const st = report.stats;
  return [
    heading,
    "",
    table(
      ["", ""],
      [
        ["Reviewed", `${at(review.createdAt, offset)} (${review.kind === "upload" ? "Reviewer upload" : "Creator expert check"})`],
        ["Cadre · state", `${report.cadre} · ${report.state || "national"}`],
        ["Notes given", review.ctx.notes || "–"],
        ["Engine · fingerprint", `${report.engine ?? "–"} · ${report.fingerprint ? report.fingerprint.slice(0, 12) : "–"}`],
        ["Size", `${st.roles} roles, ${st.activities} activities, ${st.competencies} competencies (${st.D} Domain, ${st.F} Functional, ${st.B} Behavioural${st.kcm ? `, ${st.kcm} KCM` : ""}), ${st.indicators} indicators`],
      ],
    ),
    "",
    `**Verdict:** ${report.verdict}`,
    "",
    `**Triage:** ${TRIAGE_NAME[report.triage]}. ${triageReason(report)}`,
    "",
    `**Summary:** ${report.summary}`,
    "",
    ...(report.strengths.length ? ["**Strengths:**", "", ...report.strengths.map((s) => `- ${s}`), ""] : []),
    "#### Checks",
    "",
    table(["Check", "Status", "Open findings"], report.checks.map((c) => [c.name, c.status, String(c.n)])),
    "",
    "#### Findings by severity and source",
    "",
    countsTable(findings),
    "",
    "#### Every finding",
    "",
    findings.length
      ? table(
          ["#", "Severity", "Found by", "Check", "Title", "Competencies / activities", "What was found"],
          findings.map((f, i) => [
            String(i + 1),
            SEV_NAME[f.sev],
            foundBy(f),
            report.checks.find((c) => c.key === f.check)?.name ?? f.check,
            f.title,
            f.refs.join(", ") || "–",
            f.detail.length > DETAIL_CHARS ? `${f.detail.slice(0, DETAIL_CHARS)}…` : f.detail,
          ]),
        )
      : "No findings.",
    "",
    ...(findings.length ? ["#### Finding details", "", ...findings.flatMap((f, i) => [`**${i + 1}. ${SEV_NAME[f.sev]} · ${f.title}** (${foundBy(f)})`, "", f.detail, "", `Fix: ${f.fix}`, ""])] : []),
    "#### AI checklist",
    "",
    checklistTable(report),
    "",
    "#### What this review cost",
    "",
    costSection(item, offset),
    "",
  ];
}

/** History across a FRAC's expert checks: did the triage and the finding counts move? */
function historyTable(items: ReviewAnalysisItem[], offset: number): string {
  return table(
    ["#", "Reviewed", "Triage", "Blocker", "Major", "Minor", "AI findings", "Calls", "Cost"],
    items.map((it, i) => {
      const f = it.review.report?.findings ?? [];
      return [
        String(i + 1),
        at(it.review.createdAt, offset),
        it.review.report ? TRIAGE_NAME[it.review.report.triage] : "no report",
        ...SEV_ORDER.map((s) => String(f.filter((x) => x.sev === s).length)),
        String(f.filter((x) => x.source === "agent").length),
        String(it.calls.length),
        it.calls.length ? usd(it.calls) : "–",
      ];
    }),
  );
}

/** The whole report as Markdown. */
export function buildReviewReport(input: ReviewReportInput): string {
  const offset = input.utcOffsetMinutes ?? 0;
  const latest = input.items.at(-1);
  const what = input.targetKind === "frac" ? `expert checks of ${input.targetName}` : `review of ${input.targetName}`;
  const allCalls = input.items.flatMap((i) => i.calls);
  return [
    `# Review analysis: ${input.targetName}`,
    "",
    `Target \`${input.targetId}\` (${input.targetKind === "frac" ? "FRAC" : "Reviewer upload"}). Generated ${at(input.generatedAt.toISOString(), offset).slice(0, 16)}${offset === 330 ? " IST" : ""} by \`npm run review:report\`.`,
    "",
    !latest
      ? `No ${what} found.`
      : `${input.items.length} ${input.targetKind === "frac" ? `expert check${input.items.length === 1 ? "" : "s"}` : "review"}; ${allCalls.length} AI calls in total, ${allCalls.length ? usd(allCalls) : "$0"}.`,
    "",
    ...(input.items.length > 1 ? ["## History", "", historyTable(input.items, offset), ""] : []),
    ...input.items
      .map((it, i) => ({ it, i }))
      .reverse()
      .flatMap(({ it, i }) => reviewSection(it, offset, i === input.items.length - 1 ? "## Latest review" : `## Earlier review ${i + 1}`)),
  ].join("\n");
}
