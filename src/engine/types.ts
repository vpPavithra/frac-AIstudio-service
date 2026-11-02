// Shapes from the FRAC Studio spec, section 4.

export type Severity = "B" | "M" | "m";
export type CheckKey = "bloom" | "structure" | "ladder" | "context" | "coverage";
export type FindingSource = "computed" | "agent";
export type Triage = "use" | "revise" | "rebuild";
export type SourceTier = "JD" | "Programme guideline" | "Facility standard" | "Inferred – verify";
export type CompetencyType = "Domain" | "Functional" | "Behavioural";
export type FracSize = "compact" | "standard" | "full";

export interface Level {
  label: string;
  /** 2–4 indicators; each after the first starts on a new line with "-" */
  desc: string;
}

// ---- 4.1 FRAC (Creator object) ----

export interface Posting {
  key: string;
  label: string;
}

export interface FracSource {
  title: string;
  issuer: string;
  year: string;
  use: string;
  tier: string;
}

export interface FracResearch {
  summary: string;
  sourceNotes: string;
  sources: FracSource[];
  authorised: string;
  notAuthorised: string;
  stateContext: string;
  assumptions: string;
}

export interface FracActivity {
  code: string;
  text: string;
  postings: Record<string, string>;
  source: string;
  tier: string;
  /** "ANM3@L3"; imported FRACs can hold several refs, e.g. "C1@L3, C2" */
  comp: string;
}

export interface FracRole {
  code: string;
  title: string;
  source: string;
  activities: FracActivity[];
}

export interface FracCompetency {
  code: string;
  label: string;
  description: string;
  type: string;
  area: string;
  kcm: string;
  levels: Level[] | null;
}

export interface FracLogEntry {
  at: string;
  step: number;
  feedback: string;
}

export interface Frac {
  id: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  step: number;
  cadre: string;
  cadreFull: string;
  state: string;
  size: FracSize;
  prompt: string;
  imported?: string;
  codePrefix: string;
  postings: Posting[];
  research: FracResearch | null;
  roles: FracRole[];
  competencies: FracCompetency[];
  rolesDirty: boolean;
  review: Report | null;
  log: FracLogEntry[];
}

// ---- 4.2 Review model (normalised input to the review engine) ----

export interface Ref {
  code: string;
  level: number | null;
}

export interface ModelActivity {
  code: string;
  text: string;
  /** keyed by entry of ReviewModel.postings */
  postings: Record<string, string>;
  refs: Ref[];
}

export interface ModelRole {
  code: string;
  title: string;
  refs?: Ref[];
  activities: ModelActivity[];
}

export interface ModelCompetency {
  code: string;
  label: string;
  description: string;
  type: string;
  area: string;
  kcm?: string;
  levels: Level[];
}

export interface ReviewModel {
  title: string;
  hasFrac: boolean;
  postings: string[];
  postingLabels: string[];
  roles: ModelRole[];
  competencies: ModelCompetency[];
}

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
