import { dominantPrefix, formatRefs, parseRefs } from "./refs.ts";
import type { Finding, Report } from "../../models/report.model.ts";
import type { Frac, FracRole } from "../../models/frac.model.ts";
import type { ModelCompetency, ReviewModel } from "../../models/review.model.ts";

const EMPTY_LEVELS = () => [1, 2, 3, 4, 5].map(() => ({ label: "", desc: "" }));

/** Creator FRAC → review model. Parses every ref in a mapping cell, not just the first (spec gap 5). */
export function fracToModel(f: Frac): ReviewModel {
  const prefix = f.codePrefix || dominantPrefix(f.competencies.map((c) => c.code));
  return {
    title: `${f.cadre} — ${f.state}`,
    hasFrac: true,
    hasMapping: true,
    postings: f.postings.map((p) => p.key),
    postingLabels: f.postings.map((p) => p.label),
    roles: f.roles.map((r) => ({
      code: r.code,
      title: r.title,
      activities: r.activities.map((a) => ({
        code: a.code,
        text: a.text,
        postings: { ...a.postings },
        refs: parseRefs(a.comp, prefix),
      })),
    })),
    competencies: f.competencies.map(
      (c): ModelCompetency => ({
        code: c.code,
        label: c.label,
        description: c.description,
        type: c.type,
        area: c.area,
        kcm: c.kcm,
        levels: c.levels ?? EMPTY_LEVELS(),
      }),
    ),
  };
}

export interface ModelToFracInput {
  model: ReviewModel;
  report: Report | null;
  sourceName: string;
  ownerId: string;
  id: string;
  cadre?: string;
  state?: string;
  now?: Date;
}

/** Reviewed workbook → Creator FRAC at step 6 with the report attached (spec 6.5 "Open in Create FRAC"). */
export function modelToFrac(input: ModelToFracInput): Frac {
  const { model, report } = input;
  const at = (input.now ?? new Date()).toISOString();
  const postings = model.postings.map((_, i) => ({ key: `P${i + 1}`, label: model.postingLabels[i] || model.postings[i] }));
  const keyOf = new Map(model.postings.map((p, i) => [p, `P${i + 1}`]));

  const roles: FracRole[] = model.roles.map((r) => ({
    code: r.code,
    title: r.title,
    source: "",
    activities: r.activities.map((a) => ({
      code: a.code,
      text: a.text,
      postings: Object.fromEntries(Object.entries(a.postings).map(([header, v]) => [keyOf.get(header) ?? header, v])),
      source: "",
      tier: "",
      comp: formatRefs(a.refs),
    })),
  }));

  const cadre = input.cadre || report?.cadre || model.title;
  return {
    id: input.id,
    createdAt: at,
    updatedAt: at,
    ownerId: input.ownerId,
    step: 6,
    cadre,
    cadreFull: cadre,
    state: input.state || report?.state || "",
    size: "standard",
    prompt: "",
    imported: input.sourceName,
    codePrefix: dominantPrefix(model.competencies.map((c) => c.code)) || "C",
    postings,
    research: null,
    roles,
    competencies: model.competencies.map((c) => ({
      code: c.code,
      label: c.label,
      description: c.description,
      type: c.type,
      area: c.area,
      kcm: c.kcm ?? "",
      levels: c.levels.some((l) => l.label || l.desc) ? c.levels : null,
    })),
    rolesDirty: false,
    review: report,
    log: [],
  };
}

/** Competency codes a finding points at, for the "Fix these competencies" button. */
export function competencyRefs(finding: Finding, model: ReviewModel): string[] {
  const known = new Set(model.competencies.map((c) => c.code));
  return finding.refs.filter((r) => known.has(r));
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Compact text form of the FRAC for the review prompt (spec 6.4). */
export function serializeModel(model: ReviewModel, maxChars = 200_000): string {
  const lines: string[] = [];
  if (model.postings.length) {
    lines.push("POSTINGS: " + model.postings.map((p, i) => `${p}${model.postingLabels[i] && model.postingLabels[i] !== p ? ` (${model.postingLabels[i]})` : ""}`).join("; "));
  }
  if (model.hasFrac) {
    lines.push("", "ROLES & ACTIVITIES:");
    for (const r of model.roles) {
      lines.push(`${r.code} ${r.title}`);
      for (const a of r.activities) lines.push(`  ${a.code} ${a.text} → ${formatRefs(a.refs) || "(unmapped)"}`);
    }
  }
  lines.push("", "COMPETENCIES:");
  for (const c of model.competencies) {
    lines.push(clip(`${c.code} ${c.label} [${c.type || "untyped"} / ${c.area || "-"}] — ${c.description}`, 220));
    c.levels.forEach((l, i) => {
      if (l.label || l.desc) lines.push(clip(`  L${i + 1} ${l.label} :: ${l.desc.replace(/\s*\n\s*/g, " ")}`, 170));
    });
  }
  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(truncated)` : text;
}
