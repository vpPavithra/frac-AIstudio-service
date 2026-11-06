// Review shapes: the normalised review model (spec 4.2) and the stored review record. A ReviewModel is
// what the engine reviews: services/review-engine/parse-workbook.ts builds it from an upload and
// convert.ts builds it from a FRAC. ReviewRecord is the `reviews` table row. Types only.
import type { Level } from "./frac.model.ts";
import type { Report } from "./report.model.ts";

// ---- 4.2 Review model (normalised input to the review engine) ----

/** A reference to a competency, optionally at one level ("ANM3@L3" → { code: "ANM3", level: 3 }). */
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
  /** Empty for KCM-format rows, which carry themes instead of an L1–L5 ladder (rules r3 §2). */
  levels: Level[];
  /** "kcm": a row copied from the Karmayogi Competency Model (Applicable Level + Theme n columns). */
  format?: "kcm";
  themes?: string[];
  applicableLevel?: string;
}

export interface ReviewModel {
  title: string;
  /** From a "Position: ANM" cell near the top of a sheet; used to infer the cadre. */
  position?: string;
  hasFrac: boolean;
  /** A mapping column exists on the Role–Activity sheet. False skips the mapping checks. */
  hasMapping: boolean;
  postings: string[];
  postingLabels: string[];
  roles: ModelRole[];
  competencies: ModelCompetency[];
}

/** "upload": a workbook sent to the Reviewer. "expert-check": the Creator's step 6 check of a FRAC. */
export type ReviewKind = "upload" | "expert-check";

/** Optional context the reviewer gives with an upload (cadre, state, notes). */
export interface ReviewContext {
  cadre?: string;
  state?: string;
  notes?: string;
}

export interface ReviewRecord {
  id: string;
  ownerId: string;
  fracId: string | null;
  kind: ReviewKind;
  sourceName: string;
  ctx: ReviewContext;
  /** The parsed model, kept so a past review can be reopened in the Creator. */
  sourceModel: ReviewModel | null;
  /** Null while the review job is still running. */
  report: Report | null;
  /** Review fingerprint (rules r3 §9): same file + context + engine version → same stored review. */
  fingerprint?: string | null;
  createdAt: string;
}
