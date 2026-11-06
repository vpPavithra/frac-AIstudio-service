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

/**
 * How the AI checklist answered on one review (rules r3 §6.3), for the AI response report. A flag is
 * kept only when its quote is in the competency and no rule already covers it.
 */
export interface AiChecklistStats {
  /** Laddered competencies sent to the Q1/Q2 checklist. */
  competenciesAsked: number;
  scopeRaised: number;
  accuracyRaised: number;
  /** Q1 and Q2 flags that passed the quote check and became finding lines. */
  kept: number;
  /** The quote was too short or not in that competency's text: the model said something the file does not. */
  droppedQuoteNotFound: number;
  /** An outdated-term or ladder rule already flags it. */
  droppedCoveredByRule: number;
  /** A code scope rule already hit that competency level. */
  droppedDuplicateScope: number;
  /** Q3 state-fit items returned, and kept after the category check and the cap. 0 for a national review. */
  stateRaised: number;
  stateKept: number;
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
  /** What the AI checklist raised and kept on this review (absent on reviews made before it was recorded). */
  aiChecklist?: AiChecklistStats;
}
