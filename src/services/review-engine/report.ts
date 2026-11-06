import type { CheckKey, CheckSummary, Finding, Report, Severity, Stats, Triage } from "../../models/report.model.ts";
import { TITLES } from "./checks.ts";

// Builds the report (rules r3 §7). In r3 the verdict, triage, summary and strengths are computed here
// from the findings, never written by the model, so the same findings always give the same report.
// Computed-report step of the review flow: ReviewService.review merges the rule-based findings
// (checks.ts) and the AI findings (ai-review.service.ts) through buildReport. TRIAGE_LABELS is also
// used by excel/workbook-writer.ts. Reads no config.

/** Display name of each check, in the fixed check order used for sorting and the per-check table (rules §7). */
export const CHECK_NAMES: Record<CheckKey, string> = {
  bloom: "Bloom's verbs",
  structure: "FRAC structure",
  ladder: "Level ladder",
  context: "Guidelines & context",
  coverage: "Coverage & sources",
};

/** Short triage labels for the UI and the Excel export. */
export const TRIAGE_LABELS: Record<Triage, string> = {
  use: "Use with minor edits",
  revise: "Revise",
  rebuild: "Rebuild from the job",
};

/** Opening words of the verdict per triage (rules §7). */
const VERDICT_OPENING: Record<Triage, string> = {
  rebuild: "Rebuild from the job before use",
  revise: "Revise before use",
  use: "Usable with minor edits",
};

/** Blocker sorts first, then Major, then minor. */
const SEV_RANK: Record<Severity, number> = { B: 0, M: 1, m: 2 };
const CHECK_ORDER = Object.keys(CHECK_NAMES) as CheckKey[];

/** Sort: severity, then check order, then rule-based before AI (rules §7). */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEV_RANK[a.sev] - SEV_RANK[b.sev] ||
      CHECK_ORDER.indexOf(a.check) - CHECK_ORDER.indexOf(b.check) ||
      Number(a.source === "agent") - Number(b.source === "agent"),
  );
}

/**
 * Rules §7 per-check status = worst severity among that check's open findings: B "Fix before use",
 * M "Needs work", m "Mostly fine", none "Pass". Findings marked fixed are ignored (spec gap 3).
 */
export function summariseChecks(findings: Finding[]): CheckSummary[] {
  return CHECK_ORDER.map((key) => {
    const mine = findings.filter((f) => f.check === key && !f.fixed);
    const worst = mine.reduce<Severity | null>((w, f) => (w === null || SEV_RANK[f.sev] < SEV_RANK[w] ? f.sev : w), null);
    const base = { key, name: CHECK_NAMES[key], n: mine.length };
    switch (worst) {
      case "B":
        return { ...base, status: "Fix before use", cls: "blocker" };
      case "M":
        return { ...base, status: "Needs work", cls: "major" };
      case "m":
        return { ...base, status: "Mostly fine", cls: "minor" };
      default:
        return { ...base, status: "Pass", cls: "pass" };
    }
  });
}

export interface TriageInput {
  findings: Finding[];
  laddered: number;
  incompleteLadders: number;
}

/**
 * Rules §7 triage. rebuild: activities are syllabus outcomes, no competency is typed, or more than half the laddered
 * competencies have incomplete ladders; revise: any Blocker or 3+ Majors; otherwise use.
 */
export function computeTriage({ findings, laddered, incompleteLadders }: TriageInput): Triage {
  const raised = (title: string) => findings.some((f) => f.source === "computed" && f.title === title);
  if (raised(TITLES.syllabus) || raised(TITLES.untyped) || (laddered > 0 && incompleteLadders > laddered / 2)) return "rebuild";
  const count = (sev: Severity) => findings.filter((f) => f.sev === sev).length;
  return count("B") > 0 || count("M") >= 3 ? "revise" : "use";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Scope findings from both halves: rule-based "Beyond {cadre} scope: …" and the AI "Other acts beyond …". */
const isScope = (f: Finding) => f.title.startsWith("Beyond ") || f.title.startsWith("Other acts beyond ");

/**
 * Rules §7 verdict: "{Revise before use} — 2 blockers, 4 major and 3 minor findings. Fix first: …".
 * "Fix first" names the number of rule-based scope acts, then the next two Blocker/Major titles that
 * are not scope findings. Expects `findings` already sorted (sortFindings).
 */
export function computeVerdict(triage: Triage, findings: Finding[], cadre: string): string {
  const n = (sev: Severity) => findings.filter((f) => f.sev === sev).length;
  const counts = `${plural(n("B"), "blocker")}, ${n("M")} major and ${n("m")} minor ${n("m") === 1 ? "finding" : "findings"}`;
  const scopeKinds = findings.filter((f) => f.source === "computed" && isScope(f)).length;
  const next = findings.filter((f) => f.sev !== "m" && !isScope(f)).slice(0, 2).map((f) => f.title);
  const first = [scopeKinds ? `${plural(scopeKinds, "kind")} of act beyond ${cadre} scope` : "", ...next].filter(Boolean);
  return `${VERDICT_OPENING[triage]} — ${counts}.${first.length ? ` Fix first: ${first.join("; ")}.` : ""}`;
}

/** Rules §7 summary: what was checked (counts, D/F/B split, cadre, state) and how many findings each half gave. */
export function computeSummary(stats: Stats, findings: Finding[], cadre: string, state: string): string {
  const ruleBased = findings.filter((f) => f.source === "computed").length;
  const ai = findings.length - ruleBased;
  const where = state ? `${cadre}, ${state}` : cadre;
  return (
    `Checked ${plural(stats.roles, "role")}, ${plural(stats.activities, "activity", "activities")} and ` +
    `${plural(stats.competencies, "competency", "competencies")} (${stats.D} Domain, ${stats.F} Functional, ${stats.B} Behavioural) for ${where}. ` +
    `${ruleBased} ${ruleBased === 1 ? "finding comes" : "findings come"} from rule-based checks and are the same on every run; ` +
    `${ai} ${ai === 1 ? "comes" : "come"} from AI judgement on a fixed checklist, each backed by a quote from the file.`
  );
}

/** Rules §7 strengths: the core areas covered (from the AREAS check), then each check with no findings. */
export function computeStrengths(findings: Finding[], coveredAreas: string[]): string[] {
  const clean = CHECK_ORDER.filter((key) => !findings.some((f) => f.check === key)).map((key) => `${CHECK_NAMES[key]}: no issues found`);
  return [...(coveredAreas.length ? [`Core areas covered: ${coveredAreas.join(", ")}`] : []), ...clean];
}

export interface ReportInput {
  title: string;
  cadre: string;
  state?: string;
  stats: Stats;
  computed: Finding[];
  agent: Finding[];
  coveredAreas: string[];
  laddered: number;
  incompleteLadders: number;
  engine: string;
  fingerprint: string;
  at?: Date;
}

/** Merges both halves into the stored Report: sorted findings plus computed triage, verdict, summary, strengths. */
export function buildReport(input: ReportInput): Report {
  const findings = sortFindings([...input.computed, ...input.agent]);
  const triage = computeTriage({ findings, laddered: input.laddered, incompleteLadders: input.incompleteLadders });
  const state = input.state ?? "";
  return {
    title: input.title,
    cadre: input.cadre,
    state,
    at: (input.at ?? new Date()).toISOString(),
    stats: input.stats,
    verdict: computeVerdict(triage, findings, input.cadre),
    triage,
    summary: computeSummary(input.stats, findings, input.cadre, state),
    checks: summariseChecks(findings),
    findings,
    strengths: computeStrengths(findings, input.coveredAreas),
    engine: input.engine,
    fingerprint: input.fingerprint,
  };
}
