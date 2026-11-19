// TEAM FEEDBACK AGENT (19 Nov 2026). Runs first in a step job whenever the team gave feedback or instructions; with
// neither, the step runs its normal flow and this is never called. One complex-tier call reads the feedback, the FRAC
// as it is, and every uploaded document (the competencies and roles each sheet or dictionary holds, and the text of
// job descriptions). The agent decides which competencies and roles the FRAC should have (taken from a document, kept
// from the FRAC, or written new when the feedback asks) and maps every activity to a competency@level. It answers by
// reference: code copies each picked row exactly as uploaded (codes, wording, postings, ladders), so nothing is
// retyped. Then FracService.startStep runs the clicked step with whatever feedback is left, unless the agent already
// replaced that step's own section.
// Flow: feedback agent (when feedback) -> the clicked step -> log and version.
import type { FracDocument } from "../../models/document.model.ts";
import type { Frac, FracActivity, FracCompetency, FracRole, Posting } from "../../models/frac.model.ts";
import { DOCUMENTS } from "../../config/constants.ts";
import { JOB_MESSAGES } from "../queue/job-messages.ts";
import { renumberRoles } from "./roles.step.ts";
import { feedbackAgentOutput, type FeedbackAgentOutput } from "./schemas.ts";
import { callModel, type StepContext } from "./step-context.ts";
import { feedbackAgentPrompt, type FeedbackSource } from "./prompts.ts";

/** The step the team clicked, so the agent knows which tab the feedback was written on. */
export type FeedbackTabStep = "research" | "roles" | "competencies" | "ladders";

/** What the agent did, shown on the tab and kept in the log. */
export interface FeedbackOutcome {
  summary: string;
  applied: string[];
  notApplied: { point: string; reason: string }[];
  /** Caveats about what was done. */
  notes: string[];
  /** Feedback the clicked step should still apply (research facts, wording, ladders); "" when none. */
  remaining: string;
  changed: { competencies: boolean; roles: boolean };
}

/** Postings of a source: the FRAC's own, or the ones a document's roles sheet carries. */
interface Source extends FeedbackSource {
  postings: Posting[];
}

/** The FRAC as source "F" and each document as D1..Dn, in upload order. */
export function feedbackSources(frac: Frac, documents: FracDocument[]): Source[] {
  const own: Source = {
    ref: "F", name: "This FRAC as it is now", kind: "frac",
    competencies: frac.competencies, roles: frac.roles, postings: frac.postings, text: "",
  };
  let left = DOCUMENTS.maxChars;
  const docs = documents.map((d, i): Source => {
    const text = d.kind === "brief" ? d.text.slice(0, Math.max(0, left)) : "";
    left -= text.length;
    return {
      ref: `D${i + 1}`, name: d.filename, kind: d.kind,
      competencies: d.parsed?.competencies ?? [], roles: d.parsed?.roles ?? [], postings: d.parsed?.postings ?? [], text,
    };
  });
  return [own, ...docs];
}

const norm = (s: string) => s.trim().toUpperCase();

/** One competency the agent picked: the source row as uploaded, with any field the feedback asked to change. */
function pickCompetency(item: FeedbackAgentOutput["competencies"]["items"][number], sources: Map<string, Source>): FracCompetency | null {
  const source = sources.get(norm(item.from));
  const row = source?.competencies.find((c) => norm(c.code) === norm(item.code));
  if (row) {
    const label = item.label.trim() || row.label;
    const sameLabel = label.trim().toLowerCase() === row.label.trim().toLowerCase();
    return {
      ...row,
      label,
      description: item.description.trim() || row.description,
      type: item.type.trim() || row.type,
      area: item.area.trim() || row.area,
      kcm: item.kcm.trim() || row.kcm,
      // A ladder describes its competency: kept while the name stays, rewritten by the ladders step otherwise
      levels: sameLabel ? row.levels : null,
    };
  }
  // Written new because the feedback asked for it; needs a code and a name
  if (norm(item.from) !== "NEW" || !item.code.trim() || !item.label.trim()) return null;
  return { code: item.code.trim(), label: item.label.trim(), description: item.description.trim(), type: item.type.trim() || "Domain",
    area: item.area.trim(), kcm: item.kcm.trim() || "Domain – department-defined", levels: null };
}

/** One role the agent picked, with every activity under it as uploaded, each keyed by its source ("D2:A14"). */
function pickRole(item: FeedbackAgentOutput["roles"]["items"][number], sources: Map<string, Source>) {
  const source = sources.get(norm(item.from));
  const row = source?.roles.find((r) => norm(r.code) === norm(item.code));
  if (row) {
    return {
      source: source!,
      role: { ...row, title: item.title.trim() || row.title },
      keys: row.activities.map((a) => `${source!.ref}:${norm(a.code)}`),
    };
  }
  if (norm(item.from) !== "NEW" || !item.title.trim()) return null;
  const activities: FracActivity[] = item.activities.filter((t) => t.trim())
    .map((text) => ({ code: "", text: text.trim(), postings: {}, source: "Team feedback", tier: "Inferred – verify", comp: "" }));
  return { source: null, role: { code: "", title: item.title.trim(), source: "Team feedback", activities } as FracRole, keys: activities.map(() => "") };
}

/**
 * Applies the agent's answer to the FRAC (pure, so it is tested without a model). Only sections the agent chose to
 * change are replaced. Mappings to a competency the FRAC will not have are dropped and reported, never guessed.
 */
export function applyFeedbackPlan(frac: Frac, sources: Source[], out: FeedbackAgentOutput): { patch: Partial<Frac>; outcome: FeedbackOutcome } {
  const byRef = new Map(sources.map((s) => [norm(s.ref), s]));
  const notApplied = [...out.notApplied];
  const applied: string[] = [];
  const patch: Partial<Frac> = {};

  let competencies = frac.competencies;
  if (out.competencies.change) {
    const picked: FracCompetency[] = [];
    for (const item of out.competencies.items) {
      const c = pickCompetency(item, byRef);
      if (!c) notApplied.push({ point: `Competency ${item.code || item.label}`, reason: `Not found in ${item.from}.` });
      else if (!picked.some((p) => norm(p.code) === norm(c.code))) picked.push(c);
    }
    if (picked.length) {
      competencies = picked;
      patch.competencies = picked;
      const from = [...new Set(out.competencies.items.map((i) => byRef.get(norm(i.from))?.name ?? "the feedback"))];
      applied.push(`${picked.length} ${picked.length === 1 ? "competency" : "competencies"} (${picked.map((c) => c.code).join(", ")}) from ${from.join(", ")}`);
    } else {
      notApplied.push({ point: "Competencies", reason: "None of the competencies the agent picked were found, so the competencies were left as they were." });
    }
  }

  const compCodes = new Map(competencies.map((c) => [norm(c.code), c.code]));
  const mapping = new Map<string, string>();
  const unknown = new Set<string>();
  for (const m of out.mapping) {
    const code = compCodes.get(norm(m.c));
    if (!code) {
      unknown.add(m.c);
      continue;
    }
    mapping.set(norm(m.a), `${code}@L${Math.min(5, Math.max(1, Math.round(m.l)))}`);
  }
  if (unknown.size) notApplied.push({ point: "Mapping", reason: `Skipped mappings to ${[...unknown].join(", ")}, which this FRAC does not have.` });

  let roles: FracRole[];
  if (out.roles.change) {
    const picked = out.roles.items.map((item) => ({ item, hit: pickRole(item, byRef) }));
    for (const { item, hit } of picked) if (!hit) notApplied.push({ point: `Role ${item.code || item.title}`, reason: `Not found in ${item.from}.` });
    const hits = picked.flatMap(({ hit }) => (hit ? [hit] : []));
    if (hits.length) {
      roles = hits.map(({ role, keys }) => ({ ...role, activities: role.activities.map((a, i) => ({ ...a, comp: (keys[i] && mapping.get(keys[i])) || "" })) }));
      roles = renumberRoles(roles);
      patch.roles = roles;
      // Postings follow the roles: the Yes/No columns of the document the roles came from
      const postingSource = hits.find((h) => h.source && h.source.ref !== "F" && h.source.postings.length)?.source;
      if (postingSource) patch.postings = postingSource.postings;
      const from = [...new Set(hits.map((h) => h.source?.name ?? "the feedback"))];
      const acts = roles.reduce((n, r) => n + r.activities.length, 0);
      applied.push(`${roles.length} ${roles.length === 1 ? "role" : "roles"} with ${acts} activities from ${from.join(", ")}`);
    } else {
      roles = frac.roles;
      notApplied.push({ point: "Roles", reason: "None of the roles the agent picked were found, so the roles were left as they were." });
    }
  } else {
    // Roles stay; the agent may still have mapped their activities ("F:A3"), e.g. to a new set of competencies
    roles = frac.roles.map((r) => ({ ...r, activities: r.activities.map((a) => ({ ...a, comp: mapping.get(`F:${norm(a.code)}`) ?? (patch.competencies ? "" : a.comp) })) }));
    if (mapping.size || patch.competencies) patch.roles = roles;
  }

  const activities = roles.flatMap((r) => r.activities);
  const mapped = activities.filter((a) => a.comp).length;
  if (patch.roles && competencies.length && activities.length) {
    applied.push(`mapped ${mapped} of ${activities.length} activities to the competencies`);
    patch.rolesDirty = mapped < activities.length;
  }
  if (patch.roles || patch.competencies) {
    patch.reviewStale = !!frac.review;
  }

  return {
    patch,
    outcome: {
      summary: out.summary.trim(),
      applied,
      notApplied,
      notes: out.notes.map((n) => n.trim()).filter(Boolean),
      remaining: out.remaining.trim(),
      changed: { competencies: !!patch.competencies, roles: !!patch.roles && out.roles.change },
    },
  };
}

/**
 * The agent run: one call, then the changes saved. Returns null when the team gave no feedback or instructions, so
 * the step's normal flow is untouched. The step's own call still gets the feedback first (callModel), so a point the
 * agent leaves in `remaining` is applied there.
 */
export async function runFeedbackAgent(ctx: StepContext, step: FeedbackTabStep, documents: FracDocument[]): Promise<{ frac: Frac; outcome: FeedbackOutcome } | null> {
  if (!ctx.feedback?.trim() && !ctx.guidance?.trim()) return null;
  await ctx.progress(JOB_MESSAGES.feedback, 0, 0);
  const sources = feedbackSources(ctx.frac, documents);
  const out = await callModel(ctx, "feedback", "complex", feedbackAgentPrompt(ctx.frac, step, sources),
    { step, feedback: ctx.feedback ?? "", guidance: ctx.guidance ?? "", sources: sources.map((s) => ({ ref: s.ref, name: s.name, kind: s.kind,
      competencies: s.competencies.map((c) => c.code), roles: s.roles.map((r) => ({ code: r.code, activities: r.activities.map((a) => a.code) })) })) },
    feedbackAgentOutput);
  const { patch, outcome } = applyFeedbackPlan(ctx.frac, sources, out);
  const frac = Object.keys(patch).length ? await ctx.save(() => patch) : ctx.frac;
  return { frac, outcome };
}
