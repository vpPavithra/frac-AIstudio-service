// FRAC shapes from the FRAC Studio spec, section 4.1.
import type { Report } from "./report.model.js";

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

export interface FracVersion {
  id: number;
  fracId: string;
  step: number;
  reason: string;
  createdAt: string;
}
