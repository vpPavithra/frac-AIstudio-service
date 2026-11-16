// FIXING EXPERT-CHECK FINDINGS WITH THE AGENT (review decisions, Nov 2026). FracService.startFixAll runs it as one job,
// for every open finding ("Fix all findings") or for the ones a "Fix with the agent" button names:
//  1. content findings (coverage, structure, state fit, outdated names, anything else): one complex-tier call returns
//     edits, applied here by code to codes that exist only (applyFixEdits);
//  2. ladder findings, outdated names that sit in a named competency's ladder, and any competency step 1 added: the
//     ladders step (runLadders with `codes`), with the findings as feedback.
// The model never writes the FRAC directly: unknown codes, extra competencies over FIX_ALL.maxNewCompetencies and
// empty texts are dropped. What the agent could not fix comes back as `skipped`, shown to the team.
import type { z } from "zod/v4";
import { FIX_ALL, LIMITS } from "../../config/constants.ts";
import type { Frac, FracCompetency, FracLastFix } from "../../models/frac.model.ts";
import type { Finding } from "../../models/report.model.ts";
import { normalizeCode } from "../review-engine/refs.ts";
import { fixFindingsPrompt } from "./prompts.ts";
import { fixFindingsOutput } from "./schemas.ts";
import { callModel, type StepContext } from "./step-context.ts";

export type FixEdits = z.infer<typeof fixFindingsOutput>;

/** The findings to fix, split by which part of the job fixes them. A finding can be in both. */
export interface FindingGroups {
  /** Rewritten by the ladders step for the competencies they name. */
  ladders: Finding[];
  /** Sent to the agent as content edits (activities, competency names and types, new competencies). */
  content: Finding[];
}

const isOutdatedTitle = (f: Finding) => f.title.startsWith("Outdated reference:");

/**
 * Splits the open findings, optionally only those whose titles are in `titles` (one finding's "Fix with the agent").
 * Ladder findings (Bloom's verbs, ladder shape, scope in a level) that name a competency go to the ladders step. An
 * outdated name goes to the agent for activities and names, and also to the ladders step when it names a competency,
 * since the old name can sit in that competency's level text. Everything else goes to the agent.
 */
export function groupFindings(frac: Frac, findings: Finding[], titles?: string[]): FindingGroups {
  const codes = new Set(frac.competencies.map((c) => normalizeCode(c.code)));
  const wanted = titles?.length ? new Set(titles) : null;
  const groups: FindingGroups = { ladders: [], content: [] };
  for (const finding of findings.filter((f) => !f.fixed && (!wanted || wanted.has(f.title)))) {
    const namesCompetency = finding.refs.some((r) => codes.has(normalizeCode(r)));
    const aboutLadders = finding.check === "bloom" || finding.check === "ladder"
      || (finding.check === "context" && !isOutdatedTitle(finding) && !finding.title.startsWith("Does not reflect"));
    if (aboutLadders && namesCompetency) {
      groups.ladders.push(finding);
      continue;
    }
    groups.content.push(finding);
    if (isOutdatedTitle(finding) && namesCompetency) groups.ladders.push(finding);
  }
  return groups;
}

/** Why the fix cannot run, or null: it needs an expert check with an open finding (among `titles`, when given). */
export function fixAllNotReady(frac: Frac, titles?: string[]): string | null {
  if (!frac.review) return "Run the expert check before fixing its findings";
  const open = frac.review.findings.filter((f) => !f.fixed && (!titles?.length || titles.includes(f.title)));
  if (!open.length) return titles?.length ? "That finding is no longer open; re-run the expert check" : "The expert check has no open findings to fix";
  return null;
}

/** The next free code with the FRAC's prefix: ANM7 when ANM1–ANM6 exist. */
function nextCodes(frac: Frac, count: number): string[] {
  const prefix = frac.codePrefix || "C";
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`, "i");
  const top = Math.max(0, ...frac.competencies.map((c) => Number(pattern.exec(c.code)?.[1] ?? 0)));
  return Array.from({ length: count }, (_, i) => `${prefix}${top + i + 1}`);
}

const clip = (text: string) => text.trim().slice(0, LIMITS.maxTextChars);

/**
 * Applies the agent's edits to `frac` and returns the changed roles and competencies, the codes of the competencies
 * added (they need ladders) and how many edits landed. Only codes that exist are touched; a new competency's
 * activities are re-linked to it at the given level. Pure: no I/O, so it is unit-tested directly.
 */
export function applyFixEdits(frac: Frac, edits: FixEdits, maxNew = FIX_ALL.maxNewCompetencies) {
  const existing = new Set(frac.roles.flatMap((r) => r.activities.map((a) => normalizeCode(a.code))));
  const activityText = new Map(edits.activities.filter((e) => clip(e.text)).map((e) => [normalizeCode(e.code), clip(e.text)]));
  // A new competency counts only when it covers at least one activity that exists; then the cap applies
  const added = edits.newCompetencies
    .map((c) => ({ ...c, activities: c.activities.filter((a) => existing.has(normalizeCode(a.code))) }))
    .filter((c) => clip(c.label) && c.activities.length)
    .slice(0, maxNew);
  const codes = nextCodes(frac, added.length);
  const link = new Map<string, string>();
  added.forEach((c, i) => c.activities.forEach((a) => link.set(normalizeCode(a.code), `${codes[i]}@L${a.level}`)));

  let changes = 0;
  const roles = frac.roles.map((r) => ({
    ...r,
    activities: r.activities.map((a) => {
      const key = normalizeCode(a.code);
      const text = activityText.get(key);
      const comp = link.get(key);
      if (!text && !comp) return a;
      changes += 1;
      return { ...a, ...(text ? { text } : {}), ...(comp ? { comp } : {}) };
    }),
  }));

  const edit = new Map(edits.competencies.map((e) => [normalizeCode(e.code), e]));
  const competencies: FracCompetency[] = frac.competencies.map((c) => {
    const e = edit.get(normalizeCode(c.code));
    if (!e) return c;
    const next = {
      ...c,
      ...(clip(e.label) ? { label: clip(e.label) } : {}),
      ...(clip(e.description) ? { description: clip(e.description) } : {}),
      ...(e.type ? { type: e.type } : {}),
      ...(clip(e.area) ? { area: clip(e.area) } : {}),
    };
    if (JSON.stringify(next) !== JSON.stringify(c)) changes += 1;
    return next;
  });
  const fresh: FracCompetency[] = added.map((c, i) => ({
    code: codes[i], label: clip(c.label), description: clip(c.description), type: c.type, area: clip(c.area), kcm: "", levels: null,
  }));
  changes += fresh.length;

  return { roles, competencies: [...competencies, ...fresh], newCodes: fresh.map((c) => c.code), changes };
}

/**
 * Step 2 of the job: one complex-tier call for the content findings, then applyFixEdits on the latest saved FRAC.
 * Returns the codes of added competencies (for the ladders step) and the agent's skipped list. Nothing to send → no call.
 */
export async function fixContentFindings(ctx: StepContext, findings: Finding[]): Promise<{ newCodes: string[]; skipped: FracLastFix["skipped"]; changes: number }> {
  if (!findings.length) return { newCodes: [], skipped: [], changes: 0 };
  const sent = findings.map((f) => ({ check: f.check, title: f.title, detail: f.detail, fix: f.fix, refs: f.refs }));
  const edits = await callModel(ctx, "fix-findings", "complex", fixFindingsPrompt(ctx.frac, sent, FIX_ALL.maxNewCompetencies),
    { cadre: ctx.frac.cadre, state: ctx.frac.state, findings: sent, prefix: ctx.frac.codePrefix || "C",
      activities: ctx.frac.roles.flatMap((r) => r.activities.map((a) => ({ code: a.code, text: a.text }))),
      competencies: ctx.frac.competencies.map((c) => ({ code: c.code, label: c.label, type: c.type })) },
    fixFindingsOutput);
  let result = { newCodes: [] as string[], changes: 0 };
  await ctx.save((latest) => {
    const applied = applyFixEdits(latest, edits);
    result = { newCodes: applied.newCodes, changes: applied.changes };
    return { roles: applied.roles, competencies: applied.competencies, reviewStale: !!latest.review };
  });
  // Kept as the agent wrote them: it may shorten a finding's title, and a dropped skip would hide work left to do
  const skipped = edits.skipped.slice(0, findings.length).map((s) => ({ finding: clip(s.finding), reason: clip(s.reason) }));
  return { ...result, skipped };
}
