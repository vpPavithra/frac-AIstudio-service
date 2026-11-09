// FRAC shapes from the FRAC Studio spec, section 4.1. A FRAC is the Creator's working document: the
// brief, research, roles with activities, and laddered competencies. Stored whole as JSONB (fracs.doc),
// returned as-is by /v1/fracs, and written to Excel by services/excel. Types only, no logic.
import type { Report } from "./report.model.ts";

/** How strong the evidence behind an activity is; "Inferred – verify" asks the team to check it. */
export type SourceTier = "JD" | "Programme guideline" | "Facility standard" | "Inferred – verify";
export type CompetencyType = "Domain" | "Functional" | "Behavioural";
/** Brief size; the role/activity/competency counts per size are in config/frac-sizes.json. */
export type FracSize = "compact" | "standard" | "full";

/** One proficiency level (L1–L5) of a competency ladder. */
export interface Level {
  label: string;
  /** 2–4 indicators; each after the first starts on a new line with "-" */
  desc: string;
}

// ---- 4.1 FRAC (Creator object) ----

/** A posting (work setting) column of the Role–Activity sheet; `key` is the column id in FracActivity.postings. */
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

/** One feedback entry the team gave when revising a step. */
export interface FracLogEntry {
  at: string;
  step: number;
  feedback: string;
}

/**
 * The FRAC document. `step` is the furthest Creator step reached. `rolesDirty` is set by the server when
 * roles are edited after competencies exist, so the activity→competency mappings need a look. `review` is the last expert check;
 * `reviewStale` is set by the server when the content changes after it (a fix, a revise or a hand edit) and cleared by the next check.
 */
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
  reviewStale?: boolean;
  log: FracLogEntry[];
}

/** A saved snapshot's metadata (the document itself stays in frac_versions.doc). */
export interface FracVersion {
  id: number;
  fracId: string;
  step: number;
  reason: string;
  createdAt: string;
}
