// Report shapes from the FRAC Studio spec, section 4.3.

export type Severity = "B" | "M" | "m";
export type CheckKey = "bloom" | "structure" | "ladder" | "context" | "coverage";
export type FindingSource = "computed" | "agent";
export type Triage = "use" | "revise" | "rebuild";

// ---- 4.3 Report ----

export interface Stats {
  roles: number;
  activities: number;
  competencies: number;
  indicators: number;
  B: number;
  F: number;
  D: number;
  other: number;
}

export interface Finding {
  check: CheckKey;
  sev: Severity;
  title: string;
  detail: string;
  refs: string[];
  fix: string;
  source: FindingSource;
  fixed?: boolean;
}

export type CheckStatus = "Fix before use" | "Needs work" | "Mostly fine" | "Pass";

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
}
