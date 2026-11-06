// Report shapes from the FRAC Studio spec, section 4.3. A Report is the review engine's output, for an
// uploaded workbook or a Creator expert check. Built by services/review-engine/report.ts. Types only.

/** B = blocker, M = major, m = minor. */
export type Severity = "B" | "M" | "m";
export type CheckKey = "bloom" | "structure" | "ladder" | "context" | "coverage";
/** "computed": a deterministic rule found it; "agent": an AI checklist flag that passed the quote check. */
export type FindingSource = "computed" | "agent";
/** Overall call: use as is, revise, or rebuild. Computed from the findings, not chosen by the AI. */
export type Triage = "use" | "revise" | "rebuild";

// ---- 4.3 Report ----

/** Counts shown at the top of a report. B / F / D: Behavioural, Functional and Domain competencies. */
export interface Stats {
  roles: number;
  activities: number;
  competencies: number;
  indicators: number;
  B: number;
  F: number;
  D: number;
  other: number;
  /** KCM-format competencies (themes, no L1–L5 ladder), counted separately (rules r3 §2). */
  kcm?: number;
}

export interface Finding {
  check: CheckKey;
  sev: Severity;
  title: string;
  detail: string;
  refs: string[];
  fix: string;
  source: FindingSource;
  /** Marked fixed in the Creator; summaries ignore fixed findings until the check is re-run. */
  fixed?: boolean;
}

export type CheckStatus = "Fix before use" | "Needs work" | "Mostly fine" | "Pass";

/** One row of the checks table: how many open findings a check has and the status word for it. */
export interface CheckSummary {
  key: CheckKey;
  name: string;
  n: number;
  status: CheckStatus;
  cls: "blocker" | "major" | "minor" | "pass";
}

export interface Report {
  title: string;
  cadre: string;
  state: string;
  at: string;
  stats: Stats;
  verdict: string;
  triage: Triage;
  summary: string;
  checks: CheckSummary[];
  findings: Finding[];
  strengths: string[];
  /** Review engine version and file fingerprint (rules r3 §8–9), shown in the Method row. */
  engine?: string;
  fingerprint?: string;
}
