import type { Severity } from "../../models/report.model.ts";
import type { ModelCompetency } from "../../models/review.model.ts";

// Review engine r3: the rule definitions the Reviewer and the Creator's expert check run on.
// Source: docs/spec/FRAC_Reviewer_rules_r3.md (section numbers below point into it).
//
// What lives where:
// - Rule TABLES that clinical reviewers extend live in config, read on every review (no deploy):
//     config/review-rules.json  scope acts per cadre (§4.4), ladder-shift rules (§4.3), job areas (§5)
//     config/outdated.json      outdated laws and programme names (§4.5)
//   This file only declares their shapes (OutdatedPattern, ScopeRule, LadderRule, AreaRule).
// - Fixed PATTERNS that define the method itself (Bloom's verbs, breadth tests) stay in code, below.
// - cadreFamily() decides which cadre-specific rules run; hasLadder() separates L1–L5 competencies
//   from KCM-format rows copied from the Karmayogi model.
//
// Changed in r3 (from r1): BANNED gains "knowledge of" / "has knowledge"; OutdatedPattern gains
// onlyIfAbsent / frontlineOnly / fix; everything else in this file is new. checks.ts applies the rules.
//
// Flow: config/review-rules.ts (loadReviewRules) fills a ReviewRules object on every review; ReviewService
// passes it to computeChecks (checks.ts), to the AI checklist (ai-review.service.ts, to drop flags a rule
// already covers) and to reviewFingerprint (fingerprint.ts, so a rule edit forces a fresh review).

/**
 * Rules §4.5: one outdated law, programme or term, from config/outdated.json. checks.ts raises one
 * "Outdated reference: {found}" finding per pattern that hits; the AI checklist drops any flag whose
 * quote matches one, so the model never repeats it (rules §6.3).
 */
export interface OutdatedPattern {
  id: string;
  pattern: string;
  flags: string;
  sev: Severity;
  /** The outdated name as shown in the finding title. */
  found: string;
  /** The current reference the finding tells the author to use. */
  correct: string;
  /** Suppress the hit when this pattern occurs within 80 chars of it (NEAR_WINDOW in checks.ts). */
  unlessNear?: string;
  /** Raise only when this pattern appears nowhere in the file (e.g. partograph with no LCG). */
  onlyIfAbsent?: string;
  /** Only for frontline cadres (ASHA, ANM, CHO, nurse). */
  frontlineOnly?: boolean;
  /** Overrides the default "Replace with {correct}." */
  fix?: string;
}

/**
 * Rules §4.4: one act beyond a cadre's scope, from config/review-rules.json `scope.<family>`. checks.ts tests
 * it sentence by sentence and raises one "Beyond {cadre} scope: {act}" finding per rule that hits.
 */
export interface ScopeRule {
  id: string;
  act: string;
  pattern: string;
  flags?: string;
  /** Tested on the same sentence; a match clears the hit (e.g. IV access for referral). */
  allow?: string;
  sev: Severity;
  /** What the cadre may do instead. */
  instead: string;
}

/**
 * Rules §4.3 LADDER_RULES, from config/review-rules.json `ladder`: a pattern that, found in the label or
 * description of the given levels, shows the ladder is pitched too high. All hits merge into one
 * "Level ladders are shifted upward" finding. Rules at L3 or above also drop matching AI flags (rules §6.3).
 */
export interface LadderRule {
  id: string;
  /** 1-based levels the pattern is tested on. */
  levels: number[];
  pattern: string;
  flags?: string;
  /** One line of the finding's detail, e.g. "L3 includes supervising, mentoring or training others". */
  message: string;
  frontlineOnly: boolean;
  /**
   * When true, an AI scope or accuracy flag whose quote this rule matches is dropped as a duplicate of the
   * rule-based "Level ladders are shifted upward" finding (rules §6.3: ladder rules 2 and 3). Set in config,
   * so a new ladder rule never starts dropping AI flags unless it says so.
   */
  suppressesAiFlags?: boolean;
}

/**
 * Rules §5 AREAS, from config/review-rules.json `areas`: one job area, matched on competency label +
 * description. Used for the "Core {cadre} areas with no dedicated competency" check (rules §4.6), the
 * strengths list, and (clinical areas only) the breadth test (rules §4.2.1 b).
 */
export interface AreaRule {
  key: string;
  name: string;
  pattern: string;
  flags?: string;
  /** Cadre families whose FRAC must cover this area. */
  families: CadreFamily[];
  /** Counts for the broad/overlap test (rules §4.2.1 b). */
  clinical: boolean;
}

/** Every config-driven rule table one review runs on, as loaded by config/review-rules.ts. */
export interface ReviewRules {
  scope: Partial<Record<CadreFamily, ScopeRule[]>>;
  ladder: LadderRule[];
  areas: AreaRule[];
  outdated: OutdatedPattern[];
}

/** Rules §3: the frontline cadre families. A cadre outside these gets no cadre-specific rules. */
export type CadreFamily = "asha" | "anm" | "cho" | "nurse";

// Rules §3, tested in this order. The first match wins, so "Auxiliary Nurse Midwife" is anm, not nurse.
const FAMILIES: [CadreFamily, RegExp][] = [
  ["asha", /asha/i],
  ["anm", /\banm\b|auxiliary nurse|multi[- ]?purpose|\bmpw\b|\blhv\b|lady health/i],
  ["cho", /\bcho\b|community health officer|mid[- ]?level/i],
  ["nurse", /nurse|nursing|\bgnm\b/i],
];

/** Rules §3: which cadre-specific rules apply. Every family listed is frontline. */
export function cadreFamily(cadre: string): CadreFamily | null {
  return FAMILIES.find(([, re]) => re.test(cadre))?.[0] ?? null;
}

/** Builds a RegExp from a pattern string stored in config (rule tables keep patterns as JSON strings). */
export const regex = (pattern: string, flags = "") => new RegExp(pattern, flags);

/** Rules §2: Bloom and ladder counts use only competencies with an L1–L5 ladder, not KCM-format rows. */
export const hasLadder = (c: ModelCompetency) => c.format !== "kcm";

// ---- Fixed patterns (rules §4.1, §4.2) ----

/** §4.1: a level label or indicator must not start with one of these (not measurable). */
export const BANNED =
  /^(understand|understands|understanding|know|knows|knowing|knowledge of|has knowledge|learn|learns|is aware|aware|appreciate|appreciates|is familiar|familiar|realis|realiz|comprehend)/i;
/** §4.2: an activity starting with one of these reads as a syllabus outcome, not a job action. */
export const SYLLABUS =
  /^(describe|describes|explain|explains|list|lists|enumerate|enumerates|define|defines|understand|understands|know|knows|state|states|discuss|discusses)\b/i;
// §4.2.1 "Competencies are too broadly defined", parts a, c, d and e (part b uses the clinical AREAS)
/** (a) The label names a whole field ("Clinical Skills"), not one job capability. */
export const CATCH_ALL =
  /^(clinical|nursing|medical|basic|general|core|technical|public health)\s+(skills?|care|practices?|procedures?|knowledge)\b|protocols?\s*(&|and)\s*guidelines|^(knowledge of\s+)?(health\s+)?(programmes?|programs?|schemes?|guidelines|policies)\b/i;
/** (c) The label is a list of national or state programmes or schemes ("National Health Programs"). */
export const SCHEME_LIST =
  /^(knowledge of\s+)?(the\s+)?(various\s+)?(national|state)[\w\s/&,.+-]*\b(programmes?|programs?|schemes?|policies)\b/i;
/** (d) Frontline only: about the district or state system rather than the worker's own job. */
export const ABOVE_POST =
  /\b(district|state|national)\s+(health\s+)?(organi[sz]ation|system|administration|planning|management|functioning)\b|\bhealth (system|organi[sz]ation) (and|&) functioning\b/i;
/** (e) The definition is a topic ("Knowledge of …"), not a capability. Alone, this makes the finding minor. */
export const TOPIC_DEFINITION = /^(knowledge|understanding|awareness) (of|and understanding of)/i;
/**
 * §4.2: tagged Domain, but the label is really a KCM Functional/Behavioural competency. "Planning" is the KCM
 * name, but family, birth, discharge, care and delivery planning are clinical, so they are not matched.
 */
export const DOMAIN_LOOKS_KCM =
  /knowledge sharing|communication|team ?work|leadership|coordination|community (engagement|mobili[sz]ation)|data (management|analysis|use)|(?<!(family|birth|discharge|care|delivery)\s+)planning|stakeholder|documentation|record keeping/i;
/** §4.2, frontline only: KCM Functional competencies an administrative post needs, not a frontline one. */
export const KCM_FUNCTIONAL_NOT_FRONTLINE =
  /policy architecture|financial management|procurement|administration matters|budget\w*|legislat\w*|contract management|vendor/i;
