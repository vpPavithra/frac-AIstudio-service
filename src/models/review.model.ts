// Review shapes: the normalised review model (spec 4.2) and the stored review record.
import type { Level } from "./frac.model.js";
import type { Report } from "./report.model.js";

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
  createdAt: string;
}
