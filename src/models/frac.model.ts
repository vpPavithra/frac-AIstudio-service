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
  /** Link to the document. Filled from the pages the research step's web search actually retrieved, or typed by the team; never written by the model. */
  url?: string;
}

/** The parts of research that can come from the team's documents or from the agent (research.step.ts). */
export type ResearchField = "cadreFull" | "summary" | "postings" | "authorised" | "notAuthorised" | "stateContext" | "sources";

export interface FracResearch {
  summary: string;
  sourceNotes: string;
  sources: FracSource[];
  authorised: string;
  notAuthorised: string;
  stateContext: string;
  assumptions: string;
  /** Where each part came from when the team attached documents: read from them, or researched by the agent. */
  origin?: { documents: ResearchField[]; agent: ResearchField[] };
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

/** A Creator step whose content can go out of date when an earlier step changes (see services/step-changes.ts). */
export type FracStep = "brief" | "research" | "roles" | "competencies" | "ladders";

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
  /** Who set `size`: "agent" means the research step chooses it (the brief no longer asks); "team" was picked on the old brief form. Missing on older FRACs means "team". */
  sizeBy?: "agent" | "team";
  /** The agent's one-line reason for the size it chose. */
  sizeReason?: string;
  prompt: string;
  imported?: string;
  /** The earlier FRAC or Positions entry whose postings and roles this FRAC started from (position matching). */
  seededFrom?: FracSeed;
  /** Standard sheets the team uploaded, by kind, with the file name. While set, that step uses the sheet instead of the AI. */
  uploads?: Partial<Record<SheetKind, string>>;
  codePrefix: string;
  postings: Posting[];
  research: FracResearch | null;
  roles: FracRole[];
  competencies: FracCompetency[];
  rolesDirty: boolean;
  review: Report | null;
  reviewStale?: boolean;
  /**
   * When each step's content last changed (an edit, an AI run, a sheet upload) or the team marked it checked.
   * A step with output is out of date when an earlier step changed after it. Missing on older FRACs.
   */
  changedAt?: Partial<Record<FracStep, string>>;
  log: FracLogEntry[];
}

/** Standard sheets a team can upload in place of an AI step (see services/documents). */
export type SheetKind = "roles" | "competencies" | "sources";

/** Where a matched position came from: the owner's earlier FRAC, or the FRAC module's Positions master. */
export interface FracSeed {
  from: "frac" | "positions";
  /** The FRAC id, or the position code. */
  ref: string;
  /** What the portal shows, e.g. "ANM · Bihar". */
  name: string;
  /**
   * True while the roles are still the copied set. Cleared when the roles step rebuilds them (a job description is
   * attached) or the team clears them. Missing on older FRACs: their copied roles count as still in place.
   */
  withRoles?: boolean;
}

/** A saved snapshot's metadata (the document itself stays in frac_versions.doc). */
export interface FracVersion {
  id: number;
  fracId: string;
  step: number;
  reason: string;
  createdAt: string;
}
