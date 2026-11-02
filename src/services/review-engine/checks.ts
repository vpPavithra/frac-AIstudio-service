import type { CheckKey, Finding, Severity, Stats } from "../../models/report.model.js";
import type { ModelActivity, ModelCompetency, ReviewModel } from "../../models/review.model.js";

export const BANNED =
  /^(understand|understands|understanding|know|knows|knowing|learn|learns|is aware|aware|appreciate|appreciates|is familiar|familiar|realis|realiz|comprehend)/i;
export const SYLLABUS =
  /^(describe|describes|explain|explains|list|lists|enumerate|enumerates|define|defines|understand|understands|know|knows|state|states|discuss|discusses)\b/i;

export interface OutdatedPattern {
  id: string;
  pattern: string;
  flags: string;
  sev: Severity;
  found: string;
  correct: string;
  /** suppress the hit when this pattern occurs within NEAR_WINDOW chars of it */
  unlessNear?: string;
}

const NEAR_WINDOW = 80;
const MAX_LISTED = 12;

/** Drops leading "- • * 1. )" so the first word is the verb. */
export function stripLead(text: string): string {
  return text.replace(/^(?:\s*(?:[-–•*]|\d+[.)]|\))\s*)+/, "").trim();
}

export function indicators(desc: string): string[] {
  return desc
    .split(/\n/)
    .map(stripLead)
    .filter((line) => line !== "");
}

export function typeClass(type: string): "B" | "F" | "D" | "other" {
  const first = type.trim().charAt(0).toUpperCase();
  return first === "B" || first === "F" || first === "D" ? first : "other";
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

function finding(check: CheckKey, sev: Severity, title: string, detail: string, refs: string[], fix: string): Finding {
  return { check, sev, title, detail, refs: refs.slice(0, MAX_LISTED * 2), fix, source: "computed" };
}

function allActivities(model: ReviewModel): ModelActivity[] {
  return model.roles.flatMap((r) => r.activities);
}

function bloomChecks(comps: ModelCompetency[]): Finding[] {
  const n = comps.length;
  if (!n) return [];
  const perLevel = [0, 1, 2, 3, 4].map((li) =>
    comps.filter((c) => BANNED.test(stripLead(c.levels[li]?.label ?? ""))).map((c) => c.code),
  );
  const worst = Math.max(...perLevel.map((codes) => codes.length));

  if (worst > 0) {
    const counts = perLevel
      .map((codes, li) => (codes.length ? `L${li + 1} ${codes.length}/${n}` : ""))
      .filter(Boolean)
      .join(", ");
    let detail = `Level labels starting with a non-measurable verb (Understands, Knows, Is aware of …): ${counts}.`;
    if (perLevel[0].length && perLevel[1].length) detail += " Levels 1 and 2 barely differ.";
    return [
      finding(
        "bloom",
        worst >= 0.25 * n ? "M" : "m",
        "Level labels use non-measurable verbs",
        detail,
        [...new Set(perLevel.flat())],
        "Start every level label with a measurable Bloom's verb (Identifies, Performs, Manages, Audits). Behavioural competencies use Krathwohl's affective ladder written as observable behaviour.",
      ),
    ];
  }

  const badIndicators = comps.filter((c) => c.levels.some((l) => indicators(l.desc).some((line) => BANNED.test(line))));
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

function structureChecks(model: ReviewModel): Finding[] {
  const out: Finding[] = [];
  const comps = model.competencies;

  if (model.hasFrac) {
    const acts = allActivities(model);
    const syllabus = acts.filter((a) => SYLLABUS.test(stripLead(a.text)));
    if (syllabus.length) {
      const verbs = [...new Set(syllabus.map((a) => firstWord(a.text)))].slice(0, 4).join(", ");
      out.push(
        finding(
          "structure",
          syllabus.length >= 0.3 * acts.length ? "M" : "m",
          "Activities read like syllabus outcomes",
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

  if (comps.length) {
    const classes = comps.map((c) => typeClass(c.type));
    if (classes.every((t) => t === "other")) {
      out.push(
        finding(
          "structure",
          "M",
          "Competencies are not typed",
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
  }
  return out;
}

function ladderChecks(comps: ModelCompetency[]): Finding[] {
  const out: Finding[] = [];
  const n = comps.length;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

  const incomplete = comps.filter((c) => c.levels.filter((l) => l.label.trim()).length < 5);
  if (incomplete.length) {
    out.push(
      finding(
        "ladder",
        incomplete.length > 0.1 * n ? "M" : "m",
        "Incomplete level ladders",
        `${incomplete.length} of ${n} competencies have fewer than 5 level labels: ${list(incomplete.map((c) => c.code))}.`,
        incomplete.map((c) => c.code),
        "Write all five cumulative levels (L1 Foundational → L5 Expert/Mentor).",
      ),
    );
  }

  const byL5 = new Map<string, string[]>();
  for (const c of comps) {
    const l5 = norm(c.levels[4]?.label ?? "");
    if (l5) byL5.set(l5, [...(byL5.get(l5) ?? []), c.code]);
  }
  for (const codes of byL5.values()) {
    if (codes.length < 3) continue;
    const label = comps.find((c) => c.code === codes[0])?.levels[4]?.label.trim() ?? "";
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

  const repeated = comps.filter((c) => {
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
  return out;
}

function coverageChecks(model: ReviewModel): Finding[] {
  if (!model.hasFrac) return [];
  const out: Finding[] = [];
  const acts = allActivities(model);
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

  if (model.postings.length) {
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
  return out;
}

function contextChecks(model: ReviewModel, patterns: OutdatedPattern[]): Finding[] {
  const texts: { code: string; text: string }[] = [
    ...allActivities(model).map((a) => ({ code: a.code, text: a.text })),
    ...model.competencies.map((c) => ({
      code: c.code,
      text: [c.label, c.description, ...c.levels.flatMap((l) => [l.label, l.desc])].join("\n"),
    })),
  ];

  const out: Finding[] = [];
  for (const p of patterns) {
    const re = new RegExp(p.pattern, p.flags.includes("g") ? p.flags : `${p.flags}g`);
    const near = p.unlessNear ? new RegExp(p.unlessNear, "i") : null;
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
        `Found in ${codes.length} place(s): ${list(codes)}. The current name is ${p.correct}.`,
        codes.slice(0, MAX_LISTED),
        `Replace with ${p.correct}.`,
      ),
    );
  }
  return out;
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
  };
  for (const c of model.competencies) {
    stats[typeClass(c.type)]++;
    stats.indicators += c.levels.reduce((sum, l) => sum + indicators(l.desc).length, 0);
  }
  return stats;
}

/** Spec 6.3: every countable rule, computed deterministically. */
export function computeChecks(model: ReviewModel, outdated: OutdatedPattern[]): { findings: Finding[]; stats: Stats } {
  const findings = [
    ...bloomChecks(model.competencies),
    ...structureChecks(model),
    ...ladderChecks(model.competencies),
    ...coverageChecks(model),
    ...contextChecks(model, outdated),
  ];
  return { findings, stats: computeStats(model) };
}
