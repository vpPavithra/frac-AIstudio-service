// Review shapes: the normalised review model (spec 4.2) and the stored review record.
import type { Level } from "./frac.model.ts";
import type { Report } from "./report.model.ts";

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

export type ReviewKind = "upload" | "expert-check";

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
  sourceModel: ReviewModel | null;
  report: Report | null;
  /** Review fingerprint (rules r3 §9): same file + context + engine version → same stored review. */
  fingerprint?: string | null;
  createdAt: string;
}
