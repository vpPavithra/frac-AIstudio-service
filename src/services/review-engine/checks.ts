import type { CheckKey, Finding, Severity, Stats } from "../../models/report.model.ts";
import type { ModelActivity, ModelCompetency, ReviewModel } from "../../models/review.model.ts";
import {
  ABOVE_POST,
  BANNED,
  CATCH_ALL,
  cadreFamily,
  DOMAIN_LOOKS_KCM,
  hasLadder,
  KCM_FUNCTIONAL_NOT_FRONTLINE,
  regex,
  SCHEME_LIST,
  SYLLABUS,
  TOPIC_DEFINITION,
  type AreaRule,
  type CadreFamily,
  type OutdatedPattern,
  type ReviewRules,
} from "./rules.ts";

// The rule-based half of the review (FRAC_Reviewer_rules_r3.md §4). Everything here is deterministic:
// the same model and rules always give the same findings, word for word. The AI checklist
// (ai-review.service.ts) only adds what a list or a pattern cannot decide.
//
// r3 changes from r1: Bloom and ladder counts use laddered competencies only (KCM-format rows are
// counted separately); new rules for breadth, KCM tagging, ladder shift, scope, job areas, extra
// outdated terms and the missing mapping column; results also carry the scope hits and covered areas
// that the AI checklist and the computed verdict need.

export { BANNED, SYLLABUS, type OutdatedPattern } from "./rules.ts";

const NEAR_WINDOW = 80;
const MAX_LISTED = 12;
const QUOTE_MAX = 160;

/** Rule-based finding titles that triage reads (rules §7). */
export const TITLES = Object.freeze({
  syllabus: "Activities read as syllabus outcomes",
  untyped: "Competency type is missing",
  incomplete: "Incomplete level ladders",
});

/** One sentence that a scope rule caught. level 0 = the definition (label + description). */
export interface ScopeHit {
  code: string;
  level: number;
  quote: string;
  rule: string;
}

export interface CheckContext {
  cadre?: string;
}

export interface CheckResult {
  findings: Finding[];
  stats: Stats;
  family: CadreFamily | null;
  /** The cadre as shown in titles: the brief/upload cadre, else the file's Position, else the family. */
  cadre: string;
  /** Passed to the AI checklist so it does not repeat them (rules §6.1, §6.3). */
  scopeHits: ScopeHit[];
  /** Names of the core job areas the competencies cover (for strengths). */
  coveredAreas: string[];
  /** Laddered competencies, and how many have fewer than 5 level labels (triage). */
  laddered: number;
  incompleteLadders: number;
}

/** Drops leading "- • * 1. )" so the first word is the verb. */
export function stripLead(text: string): string {
  return text.replace(/^(?:\s*(?:[-–•*]|\d+[.)]|\))\s*)+/, "").trim();
}

/**
 * Indicators of one level: one per line, or joined inline with " -" as in the entity-service master
 * data ("Conducts the test -Interprets results").
 */
export function indicators(desc: string): string[] {
  return desc
    .split(/\n|\s-(?=\s?[A-Z])/)
    .map(stripLead)
    .filter((line) => line !== "");
}

export function typeClass(type: string): "B" | "F" | "D" | "other" {
  const first = type.trim().charAt(0).toUpperCase();
  return first === "B" || first === "F" || first === "D" ? first : "other";
}

/** "D44 L3", "D47 definition". */
export const levelName = (level: number) => (level === 0 ? "definition" : `L${level}`);

/** Every piece of a competency's text with its level: 0 = label + description (+ KCM themes), 1–5 = the ladder. */
export function competencyTexts(c: ModelCompetency): { level: number; text: string }[] {
  return [
    { level: 0, text: [c.label, c.description, ...(c.themes ?? [])].filter(Boolean).join(". ") },
    ...c.levels.map((l, i) => ({ level: i + 1, text: [l.label, l.desc].filter(Boolean).join(". ") })),
  ].filter((t) => t.text.trim());
}

/** Splits text into sentences and indicators (new lines or inline " -"); the scope check tests each one (rules §4.4). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.;!?])\s+|\n+|\s-(?=\s?[A-Z])/)
    .map(stripLead)
    .filter(Boolean);
}

function firstWord(text: string): string {
  return stripLead(text).split(/\s+/)[0] ?? "";
}

function list(codes: string[]): string {
  const shown = codes.slice(0, MAX_LISTED).join(", ");
  return codes.length > MAX_LISTED ? `${shown} and ${codes.length - MAX_LISTED} more` : shown;
}

function pct(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "0%";
}

const clip = (s: string, max = QUOTE_MAX) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function finding(check: CheckKey, sev: Severity, title: string, detail: string, refs: string[], fix: string): Finding {
  return { check, sev, title, detail, refs: [...new Set(refs)].slice(0, MAX_LISTED * 2), fix, source: "computed" };
}

function allActivities(model: ReviewModel): ModelActivity[] {
  return model.roles.flatMap((r) => r.activities);
}

const labelAndDesc = (c: ModelCompetency) => `${c.label}\n${c.description}`;

// ---- 4.1 Bloom's verbs (laddered competencies only) ----

function bloomChecks(laddered: ModelCompetency[]): Finding[] {
  const n = laddered.length;
  if (!n) return [];
  const perLevel = [0, 1, 2, 3, 4].map((li) =>
    laddered.filter((c) => BANNED.test(stripLead(c.levels[li]?.label ?? ""))).map((c) => c.code),
  );
  const worst = Math.max(...perLevel.map((codes) => codes.length));

  if (worst > 0) {
    const counts = perLevel
      .map((codes, li) => (codes.length ? `L${li + 1} ${codes.length}/${n}` : ""))
      .filter(Boolean)
      .join(", ");
    let detail = `Level labels starting with a non-measurable verb (Understands, Knows, Has knowledge of …): ${counts}.`;
    if (perLevel[0].length && perLevel[1].length) detail += " Levels 1 and 2 barely differ.";
    return [
      finding(
        "bloom",
        worst >= 0.25 * n ? "M" : "m",
        "Level labels use non-measurable verbs",
        detail,
        perLevel.flat(),
        "Start every level label with a measurable Bloom's verb (Identifies, Performs, Manages, Audits). Behavioural competencies use Krathwohl's affective ladder written as observable behaviour.",
      ),
    ];
  }

  const badIndicators = laddered.filter((c) => c.levels.some((l) => indicators(l.desc).some((line) => BANNED.test(line))));
  if (!badIndicators.length) return [];
  return [
    finding(
      "bloom",
      "m",
      "Some indicators use non-measurable verbs",
      `${badIndicators.length} of ${n} competencies have an indicator starting with Understands / Knows / Is aware of.`,
      badIndicators.map((c) => c.code),
      "Rewrite each indicator so it is assessable by OSCE, observation, record audit or MCQ.",
    ),
  ];
}

// ---- 4.2 FRAC structure ----

/** Clinical areas a competency's label + description touch (rules §4.2.1 b). */
function clinicalAreas(c: ModelCompetency, areas: AreaRule[]): string[] {
  const text = labelAndDesc(c);
  return areas.filter((a) => a.clinical && regex(a.pattern, a.flags).test(text)).map((a) => a.key);
}

/**
 * Rules §4.2.1: one finding for every way a Domain competency is too broad to assess.
 * (a) catch-all labels, (b) spans 3+ clinical areas and overlaps 2+ others, (c) programme/scheme
 * lists, (d) frontline only: pitched at the district/state system, (e) definitions written as topics.
 * Parts a–d make it Major and are counted in "{n} of {N}"; part e alone makes it minor.
 */
function breadthCheck(domain: ModelCompetency[], frontline: boolean, areas: AreaRule[]): Finding[] {
  if (!domain.length) return [];
  const catchAll = domain.filter((c) => CATCH_ALL.test(c.label.trim()));
  const tags = new Map(domain.map((c) => [c.code, clinicalAreas(c, areas)]));
  // Several narrow competencies in one area (e.g. separate newborn ones) are good design: only a
  // competency that is itself broad (3+ areas) and overlaps others is flagged
  const broad = domain.filter((c) => {
    const mine = tags.get(c.code) ?? [];
    if (mine.length < 3) return false;
    const sharing = domain.filter((o) => o.code !== c.code && (tags.get(o.code) ?? []).some((a) => mine.includes(a)));
    return sharing.length >= 2;
  });
  const schemes = domain.filter((c) => SCHEME_LIST.test(c.label.trim()));
  const above = frontline ? domain.filter((c) => ABOVE_POST.test(labelAndDesc(c))) : [];
  const topics = domain.filter((c) => TOPIC_DEFINITION.test(stripLead(c.description)));

  const tooBroad = [...new Set([...catchAll, ...broad, ...schemes, ...above].map((c) => c.code))];
  if (!tooBroad.length && !topics.length) return [];

  const codes = (cs: ModelCompetency[]) => list(cs.map((c) => c.code));
  const lines = [
    tooBroad.length
      ? `${tooBroad.length} of ${domain.length} Domain competencies are too broad to assess as one job capability.`
      : `${topics.length} of ${domain.length} Domain competency definitions are written as topics, not job capabilities.`,
    catchAll.length ? `Catch-all labels that name a whole field: ${codes(catchAll)}.` : "",
    broad.length ? `Broad competencies spanning 3 or more clinical areas that more specific ones already cover: ${codes(broad)}.` : "",
    schemes.length ? `Lists of programmes or schemes: ${codes(schemes)}.` : "",
    above.length ? `Pitched at the district or state system, above the post: ${codes(above)}.` : "",
    topics.length && tooBroad.length ? `${topics.length} definitions are topics ("Knowledge of / Understanding of …"): ${codes(topics)}.` : "",
  ].filter(Boolean);

  return [
    finding(
      "structure",
      tooBroad.length ? "M" : "m",
      "Competencies are too broadly defined",
      lines.join("\n"),
      [...tooBroad, ...topics.map((c) => c.code)],
      "Define each competency as one job capability that can be observed and assessed, e.g. \"Conducts ANC contacts to protocol and refers high-risk pregnancies\". Drop catch-all competencies and share their content out to the specific ones; give each job area one home competency; fold scheme lists into the competencies where each scheme is used; narrow district or state content to what the worker does in that system.",
    ),
  ];
}

function structureChecks(model: ReviewModel, frontline: boolean, areas: AreaRule[]): Finding[] {
  const out: Finding[] = [];
  const comps = model.competencies;

  if (!model.hasFrac) {
    out.push(
      finding(
        "structure",
        "M",
        "No Role–Activity sheet",
        "The file has competencies but no sheet of roles and activities, so the FRAC cannot show which job activities need each competency.",
        [],
        "Add the Role–Activity sheet: roles as areas of work, each with observable activities mapped to competency@level.",
      ),
    );
  } else {
    const acts = allActivities(model);
    const syllabus = acts.filter((a) => SYLLABUS.test(stripLead(a.text)));
    if (syllabus.length) {
      const verbs = [...new Set(syllabus.map((a) => firstWord(a.text)))].slice(0, 4).join(", ");
      out.push(
        finding(
          "structure",
          syllabus.length >= 0.3 * acts.length ? "M" : "m",
          TITLES.syllabus,
          `${syllabus.length}/${acts.length} activities (${pct(syllabus.length, acts.length)}) start with a syllabus verb (${verbs}).`,
          syllabus.map((a) => a.code),
          "Rewrite activities as observable workplace actions with performance verbs (Conduct, Screen, Refer, Maintain).",
        ),
      );
    }

    const thin = model.roles.filter((r) => r.activities.length < 2);
    if (thin.length) {
      out.push(
        finding(
          "structure",
          "m",
          "Roles with fewer than 2 activities",
          `${thin.length} role(s) have fewer than 2 activities: ${list(thin.map((r) => r.code))}.`,
          thin.map((r) => r.code),
          "Merge thin roles or add the missing activities from the job description.",
        ),
      );
    }
  }

  if (!comps.length) return out;
  const classes = comps.map((c) => typeClass(c.type));
  if (classes.every((t) => t === "other")) {
    out.push(
      finding(
        "structure",
        "M",
        TITLES.untyped,
        "No competency has a Domain / Functional / Behavioural type.",
        [],
        "Type every competency as Domain, Functional or Behavioural per the CBC Karmayogi Competency Model.",
      ),
    );
  } else {
    const missing = (["B", "F"] as const).filter((t) => !classes.includes(t));
    if (missing.length) {
      const names = missing.map((t) => (t === "B" ? "Behavioural" : "Functional")).join(" or ");
      out.push(
        finding(
          "structure",
          "M",
          `No ${names} competencies`,
          `The dictionary has no ${names} competencies; a Karmayogi FRAC needs a real mix alongside Domain.`,
          [],
          "Add B/F competencies mapped to KCM (13 B + 21 F).",
        ),
      );
    }
  }

  // Untyped competencies count as Domain for the breadth test: they are almost always job content
  const domain = comps.filter((c) => ["D", "other"].includes(typeClass(c.type)));
  out.push(...breadthCheck(domain, frontline, areas));

  const looksKcm = comps.filter((c) => typeClass(c.type) === "D" && DOMAIN_LOOKS_KCM.test(c.label));
  if (looksKcm.length) {
    out.push(
      finding(
        "structure",
        "m",
        "Domain competencies that match KCM Functional or Behavioural names",
        `${looksKcm.length} competencies tagged Domain have a label that is a KCM Functional or Behavioural competency: ${list(looksKcm.map((c) => `${c.code} "${c.label}"`))}.`,
        looksKcm.map((c) => c.code),
        "Re-type these as Functional or Behavioural and use the KCM name, or narrow them to the domain-specific job capability.",
      ),
    );
  }

  if (frontline) {
    const notDemanded = comps.filter((c) => KCM_FUNCTIONAL_NOT_FRONTLINE.test(c.label));
    if (notDemanded.length) {
      out.push(
        finding(
          "structure",
          "m",
          "KCM competencies this post does not demand",
          `${list(notDemanded.map((c) => `${c.code} "${c.label}"`))} belong to administrative or policy posts, not frontline work.`,
          notDemanded.map((c) => c.code),
          "Remove KCM Functional competencies the post does not use, or keep only the part the worker actually does.",
        ),
      );
    }
  }
  return out;
}

// ---- 4.3 Level ladder ----

const LADDER_FIX =
  "Re-anchor every ladder: L1 states and recognises; L2 performs with a supervisor present; L3 performs alone to protocol; L4 handles complications and variation within the cadre's scope, and decides on referral; L5 mentors peers and ASHAs, and runs facility-level audits and quality improvement (e.g. NQAS checklists). Remove policy, research and state-level work from every level.";

function ladderChecks(model: ReviewModel, laddered: ModelCompetency[], rules: ReviewRules, frontline: boolean): Finding[] {
  const out: Finding[] = [];
  const n = laddered.length;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

  const incomplete = laddered.filter((c) => c.levels.filter((l) => l.label.trim()).length < 5);
  if (incomplete.length) {
    out.push(
      finding(
        "ladder",
        incomplete.length > 0.1 * n ? "M" : "m",
        TITLES.incomplete,
        `${incomplete.length} of ${n} competencies have fewer than 5 level labels: ${list(incomplete.map((c) => c.code))}.`,
        incomplete.map((c) => c.code),
        "Write all five cumulative levels (L1 Foundational → L5 Expert/Mentor).",
      ),
    );
  }

  const kcm = model.competencies.filter((c) => !hasLadder(c));
  if (kcm.length) {
    out.push(
      finding(
        "ladder",
        "M",
        "Functional and Behavioural competencies have no job ladder",
        `${kcm.length} competencies are copied in KCM format (applicable level and themes) with no L1–L5 ladder for this job: ${list(kcm.map((c) => c.code))}.`,
        kcm.map((c) => c.code),
        "Write an L1–L5 ladder for each, describing what the competency looks like in this job at each level.",
      ),
    );
  }

  const byL5 = new Map<string, string[]>();
  for (const c of laddered) {
    const l5 = norm(c.levels[4]?.label ?? "");
    if (l5) byL5.set(l5, [...(byL5.get(l5) ?? []), c.code]);
  }
  for (const codes of byL5.values()) {
    if (codes.length < 3) continue;
    const label = laddered.find((c) => c.code === codes[0])?.levels[4]?.label.trim() ?? "";
    out.push(
      finding(
        "ladder",
        "M",
        "Generic L5 label repeated across competencies",
        `"${label}" is the L5 label of ${codes.length} competencies: ${list(codes)}.`,
        codes,
        "Write an L5 specific to each competency (audit, mentoring or improving that system).",
      ),
    );
  }

  const repeated = laddered.filter((c) => {
    const labels = c.levels.map((l) => norm(l.label)).filter(Boolean);
    return new Set(labels).size < labels.length;
  });
  if (repeated.length) {
    out.push(
      finding(
        "ladder",
        "m",
        "Same label at two levels",
        `${repeated.length} competencies repeat a label across levels: ${list(repeated.map((c) => c.code))}.`,
        repeated.map((c) => c.code),
        "Make each level label distinct so the progression is visible.",
      ),
    );
  }

  // LADDER_RULES (config): one finding listing every rule that hit, with counts and codes
  const shifts = rules.ladder
    .filter((r) => frontline || !r.frontlineOnly)
    .map((r) => {
      const re = regex(r.pattern, r.flags);
      const hit = laddered.filter((c) => r.levels.some((lv) => re.test(`${c.levels[lv - 1]?.label ?? ""}\n${c.levels[lv - 1]?.desc ?? ""}`)));
      return { r, hit };
    })
    .filter((x) => x.hit.length);
  if (shifts.length) {
    const lines = shifts.map(({ r, hit }) => `${r.message}: ${hit.length} of ${n} competencies (${list(hit.map((c) => c.code))}).`);
    lines.push("With the ladder shifted up, the Karmayogi crosswalk (L1 Awareness, L2–L3 Application, L4 Leveraging, L5 Expert) rates the worker at the wrong level.");
    out.push(finding("ladder", "M", "Level ladders are shifted upward", lines.join("\n"), shifts.flatMap((s) => s.hit.map((c) => c.code)), LADDER_FIX));
  }
  return out;
}

// ---- 4.4 Scope (sentence by sentence) and 4.5 Outdated terms ----

function scopeChecks(model: ReviewModel, family: CadreFamily | null, rules: ReviewRules, cadre: string): { findings: Finding[]; hits: ScopeHit[] } {
  const scopeRules = family ? (rules.scope[family] ?? []) : [];
  const hits: ScopeHit[] = [];
  const findings: Finding[] = [];
  for (const rule of scopeRules) {
    const re = regex(rule.pattern, rule.flags);
    const allow = rule.allow ? regex(rule.allow, "i") : null;
    const mine: ScopeHit[] = [];
    for (const c of model.competencies) {
      for (const { level, text } of competencyTexts(c)) {
        const sentence = sentences(text).find((s) => re.test(s) && !(allow && allow.test(s)));
        if (sentence) mine.push({ code: c.code, level, quote: clip(sentence), rule: rule.id });
      }
    }
    if (!mine.length) continue;
    hits.push(...mine);
    const where = mine.map((h) => `${h.code} ${levelName(h.level)}`);
    findings.push(
      finding(
        "context",
        rule.sev,
        `Beyond ${cadre} scope: ${rule.act}`,
        `Found in ${list(where)}. Example (${where[0]}): "${mine[0].quote}". What the ${cadre} may do instead: ${rule.instead}.`,
        mine.map((h) => h.code),
        `Rewrite as "Identifies…, gives the pre-referral care the ${cadre} is authorised for, and refers", or tag the act "verify" against the state ${cadre} job description.`,
      ),
    );
  }
  return { findings, hits };
}

function contextChecks(model: ReviewModel, patterns: OutdatedPattern[], frontline: boolean): Finding[] {
  const texts: { code: string; text: string }[] = [
    ...allActivities(model).map((a) => ({ code: a.code, text: a.text })),
    ...model.competencies.map((c) => ({ code: c.code, text: competencyTexts(c).map((t) => t.text).join("\n") })),
  ];
  const whole = texts.map((t) => t.text).join("\n");

  const out: Finding[] = [];
  for (const p of patterns) {
    if (p.frontlineOnly && !frontline) continue;
    if (p.onlyIfAbsent && regex(p.onlyIfAbsent, "i").test(whole)) continue;
    const re = regex(p.pattern, p.flags.includes("g") ? p.flags : `${p.flags}g`);
    const near = p.unlessNear ? regex(p.unlessNear, "i") : null;
    const codes: string[] = [];
    for (const { code, text } of texts) {
      const hit = [...text.matchAll(re)].some((m) => {
        if (!near) return true;
        const at = m.index ?? 0;
        return !near.test(text.slice(Math.max(0, at - NEAR_WINDOW), at + m[0].length + NEAR_WINDOW));
      });
      if (hit && !codes.includes(code)) codes.push(code);
    }
    if (!codes.length) continue;
    out.push(
      finding(
        "context",
        p.sev,
        `Outdated reference: ${p.found}`,
        `Found in ${codes.length} place(s): ${list(codes)}. The current reference is ${p.correct}.`,
        codes.slice(0, MAX_LISTED),
        p.fix ?? `Replace with ${p.correct}.`,
      ),
    );
  }
  return out;
}

// ---- 4.6 Coverage ----

function coverageChecks(model: ReviewModel, family: CadreFamily | null, areas: AreaRule[], cadre: string): { findings: Finding[]; covered: string[] } {
  const out: Finding[] = [];
  const acts = allActivities(model);

  if (model.hasFrac && !model.hasMapping) {
    // No mapping column: one minor instead of the unmapped / unused / undefined checks
    out.push(
      finding(
        "coverage",
        "m",
        "Activities are not mapped to competencies yet",
        `The Role–Activity sheet has no mapping column, so none of the ${acts.length} activities point to a competency. The unmapped and unused checks were skipped.`,
        [],
        "Add a competency column to the Role–Activity sheet and map each activity to exactly one competency at the level the job demands (usually L3 or L4).",
      ),
    );
  } else if (model.hasFrac) {
    const defined = new Set(model.competencies.map((c) => c.code));
    const unmapped = acts.filter((a) => !a.refs.length);
    if (unmapped.length) {
      const quoted = unmapped
        .slice(0, 3)
        .map((a) => `${a.code} "${a.text}"`)
        .join("; ");
      out.push(
        finding(
          "coverage",
          unmapped.length >= 0.05 * acts.length ? "M" : "m",
          "Activities not mapped to a competency",
          `${unmapped.length} of ${acts.length} activities have no competency mapping, e.g. ${quoted}.`,
          unmapped.map((a) => a.code),
          "Map each activity to exactly one competency at the level the job demands (usually L3 or L4).",
        ),
      );
    }

    const allRefs = [...acts.flatMap((a) => a.refs), ...model.roles.flatMap((r) => r.refs ?? [])];
    const used = new Set(allRefs.map((r) => r.code));
    const unused = model.competencies.filter((c) => !used.has(c.code));
    if (unused.length) {
      out.push(
        finding(
          "coverage",
          "m",
          "Competencies never used",
          `${unused.length} competencies are not mapped from any activity: ${list(unused.map((c) => c.code))}.`,
          unused.map((c) => c.code),
          "Map each to an activity that needs it, or remove it.",
        ),
      );
    }

    const undefinedCodes = [...new Set(allRefs.map((r) => r.code).filter((code) => !defined.has(code)))];
    if (undefinedCodes.length) {
      out.push(
        finding(
          "coverage",
          "M",
          "Mappings point to undefined competencies",
          `The FRAC sheet refers to ${undefinedCodes.length} code(s) missing from the competency sheet: ${list(undefinedCodes)}.`,
          undefinedCodes,
          "Fix the mapping or add the missing competencies.",
        ),
      );
    }
  }

  if (model.hasFrac && model.postings.length) {
    const blank = acts.filter((a) => model.postings.every((p) => !(a.postings[p] ?? "").trim()));
    if (blank.length && blank.length < acts.length) {
      out.push(
        finding(
          "coverage",
          "m",
          "Activities with no posting marked",
          `${blank.length} activities have every posting column blank: ${list(blank.map((a) => a.code))}.`,
          blank.map((a) => a.code),
          "Mark Yes/No for each posting.",
        ),
      );
    }
  }

  // AREAS (config): every area for this cadre family must match some competency label or definition
  const mineAreas = family ? areas.filter((a) => a.families.includes(family)) : [];
  const compText = model.competencies.map(labelAndDesc).join("\n");
  const covered: string[] = [];
  const missing: string[] = [];
  const needing: string[] = [];
  for (const area of mineAreas) {
    const re = regex(area.pattern, area.flags);
    if (re.test(compText)) {
      covered.push(area.name);
      continue;
    }
    const need = acts.filter((a) => re.test(a.text)).map((a) => a.code);
    needing.push(...need);
    missing.push(need.length ? `${area.name} (activities ${list(need)} need it)` : area.name);
  }
  if (missing.length) {
    out.push(
      finding(
        "coverage",
        "M",
        `Core ${cadre} areas with no dedicated competency`,
        `No competency label or definition covers: ${missing.join("; ")}.`,
        needing,
        "Add one competency per missing area, written as a job capability, and map the activities that need it.",
      ),
    );
  }
  return { findings: out, covered };
}

export function computeStats(model: ReviewModel): Stats {
  const stats: Stats = {
    roles: model.roles.length,
    activities: allActivities(model).length,
    competencies: model.competencies.length,
    indicators: 0,
    B: 0,
    F: 0,
    D: 0,
    other: 0,
    kcm: 0,
  };
  for (const c of model.competencies) {
    stats[typeClass(c.type)]++;
    if (!hasLadder(c)) stats.kcm = (stats.kcm ?? 0) + 1;
    stats.indicators += c.levels.reduce((sum, l) => sum + indicators(l.desc).length, 0);
  }
  return stats;
}

/** The cadre named in titles: the context's, else the file's Position line, else the family. */
export function displayCadre(model: ReviewModel, ctx: CheckContext): string {
  return ctx.cadre?.trim() || model.position?.trim() || cadreFamily(model.title)?.toUpperCase() || "this cadre";
}

/** Rules r3 §4: every rule that a list or a pattern can decide, computed deterministically. */
export function computeChecks(model: ReviewModel, rules: ReviewRules, ctx: CheckContext = {}): CheckResult {
  const family = cadreFamily(ctx.cadre || model.position || model.title);
  const frontline = family !== null;
  const cadre = displayCadre(model, ctx);
  const laddered = model.competencies.filter(hasLadder);
  const scope = scopeChecks(model, family, rules, cadre);
  const coverage = coverageChecks(model, family, rules.areas, cadre);

  const findings = [
    ...bloomChecks(laddered),
    ...structureChecks(model, frontline, rules.areas),
    ...ladderChecks(model, laddered, rules, frontline),
    ...scope.findings,
    ...contextChecks(model, rules.outdated, frontline),
    ...coverage.findings,
  ];
  return {
    findings,
    stats: computeStats(model),
    family,
    cadre,
    scopeHits: scope.hits,
    coveredAreas: coverage.covered,
    laddered: laddered.length,
    incompleteLadders: laddered.filter((c) => c.levels.filter((l) => l.label.trim()).length < 5).length,
  };
}
