import type { ZodType, ZodTypeDef } from "zod";
import type { AiTask, TextProvider } from "../providers/text/types.ts";
import { reviewChecklistPrompt, reviewStatePrompt, STATE_CATEGORIES, type ChecklistCompetency } from "./ai/prompts.ts";
import { reviewChecklistOutput, reviewStateOutput } from "./ai/schemas.ts";
import { runInBatches } from "./ai/batching.ts";
import type { RecordUsage } from "./queue/job-runner.ts";
import { competencyTexts, levelName, type CheckResult } from "./review-engine/checks.ts";
import { serializeModel } from "./review-engine/convert.ts";
import { hasLadder, regex, type ReviewRules } from "./review-engine/rules.ts";
import type { Finding } from "../models/report.model.ts";
import type { ReviewModel } from "../models/review.model.ts";
import { ApiError } from "../utils/response.ts";

// The AI half of the review (rules r3 §6). Vidya answers fixed questions only: Q1 scope and Q2
// accuracy per competency, Q3 state fit once. Every flag must quote the file; code checks the quote,
// drops what the rule-based checks already cover, and merges the rest into at most three findings
// with fixed titles. The model never writes titles, severities, fixes, the verdict or the summary.

/** Rules §6.1: 6 competencies per call, 3 calls in parallel. */
const CHECKLIST_BATCH = 6;
const CHECKLIST_PARALLEL = 3;
const MAX_STATE_ITEMS = 6;
const MIN_QUOTE_WORDS = 4;

export interface AgentReviewInput {
  model: ReviewModel;
  /** Cadre as shown in titles. */
  cadre: string;
  state?: string;
  /** The rule-based results: scope hits are passed to the model and used to drop duplicates. */
  checks: CheckResult;
  rules: ReviewRules;
  /** Adds each model call's spend to the job (spec 9). */
  recordUsage?: RecordUsage;
}

/** The AI judgement of a review: at most three findings, all tagged `source: "agent"`. */
export interface AgentReviewer {
  review(input: AgentReviewInput): Promise<Finding[]>;
}

/** Rules §6.3: lowercase, strip quotes, dashes to spaces, drop other punctuation, collapse whitespace. */
export function normaliseQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/["'“”‘’`]/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The level whose text contains the quote (0 = definition), or null when the quote is not in the competency. */
export function locateQuote(quote: string, model: ReviewModel, code: string): number | null {
  const q = normaliseQuote(quote);
  if (q.split(" ").length < MIN_QUOTE_WORDS) return null;
  const comp = model.competencies.find((c) => c.code === code);
  if (!comp) return null;
  return competencyTexts(comp).find((t) => normaliseQuote(t.text).includes(q))?.level ?? null;
}

interface Flag {
  code: string;
  level: number;
  line: string;
  correct?: string;
}

interface StateItem {
  category: string;
  item: string;
  refs: string[];
}

const byCodeThenLevel = (a: Flag, b: Flag) => a.code.localeCompare(b.code, undefined, { numeric: true }) || a.level - b.level;

const isNational = (state?: string) => !state || /national|^india$/i.test(state.trim());

/** Calls the provider (Claude, or the mock without an API key) on the fixed checklist. */
export class ChecklistReviewer implements AgentReviewer {
  constructor(private readonly provider: TextProvider) {}

  async review(input: AgentReviewInput): Promise<Finding[]> {
    const { model, cadre, state, checks, rules } = input;
    const laddered = model.competencies.filter(hasLadder);
    const scopeHitText = (codes: string[]) =>
      checks.scopeHits.filter((h) => codes.includes(h.code)).map((h) => `${h.code} ${levelName(h.level)}: ${h.rule} — "${h.quote}"`);

    // Q1 + Q2 per competency, in batches
    const items = await runInBatches(
      laddered,
      CHECKLIST_BATCH,
      CHECKLIST_PARALLEL,
      async (batch) => {
        const comps: ChecklistCompetency[] = batch.map((c) => ({
          code: c.code,
          text: competencyTexts(c).map((t) => `${t.level === 0 ? "Definition" : levelName(t.level)}: ${t.text}`).join("\n"),
        }));
        const out = await this.ask(
          "review-competencies",
          reviewChecklistPrompt(cadre, state ?? "", comps, scopeHitText(batch.map((c) => c.code))),
          { cadre, state, competencies: comps },
          reviewChecklistOutput,
          input.recordUsage,
        );
        return out.items;
      },
      async () => undefined,
    );

    // Verification in code (rules §6.3): the quote must be in that competency, and not already covered by a rule
    const overlapsRule = (quote: string) =>
      rules.outdated.some((p) => regex(p.pattern, p.flags.replace("g", "")).test(quote)) ||
      rules.ladder.filter((r) => r.levels.some((l) => l >= 3)).some((r) => regex(r.pattern, r.flags).test(quote));
    const codeScope = new Set(checks.scopeHits.map((h) => `${h.code}|${h.level}`));

    const scope: Flag[] = [];
    const accuracy: Flag[] = [];
    for (const item of items) {
      for (const f of item.scope) {
        const level = locateQuote(f.quote, model, item.code);
        if (level === null || overlapsRule(f.quote) || codeScope.has(`${item.code}|${level}`)) continue;
        scope.push({ code: item.code, level, line: `${item.code} ${levelName(level)}: "${f.quote.trim()}" — ${f.act}${f.basis ? `; ${f.basis}` : ""}` });
      }
      for (const f of item.accuracy) {
        const level = locateQuote(f.quote, model, item.code);
        if (level === null || overlapsRule(f.quote)) continue;
        accuracy.push({ code: item.code, level, line: `${item.code} ${levelName(level)}: "${f.quote.trim()}" — ${f.issue}`, correct: f.correct });
      }
    }

    // Q3 state fit, only for a named state
    let stateItems: StateItem[] = [];
    if (!isNational(state)) {
      const out = await this.ask(
        "review-state",
        reviewStatePrompt(cadre, state ?? "", serializeModel(model)),
        { cadre, state, competencyCodes: model.competencies.map((c) => c.code) },
        reviewStateOutput,
        input.recordUsage,
      );
      const order = (category: string) => STATE_CATEGORIES.indexOf(category as (typeof STATE_CATEGORIES)[number]);
      stateItems = out.items
        .filter((i) => order(i.category) >= 0 && i.item.trim())
        .slice(0, MAX_STATE_ITEMS)
        .sort((a, b) => order(a.category) - order(b.category) || a.item.localeCompare(b.item));
    }

    return merge(scope, accuracy, stateItems, cadre, state ?? "");
  }

  /** One model call: records its spend first (so a bad answer is still billed), then validates the shape. */
  private async ask<T>(task: AiTask, prompt: string, input: unknown, schema: ZodType<T, ZodTypeDef, unknown>, recordUsage?: RecordUsage): Promise<T> {
    const result = await this.provider.complete({ task, tier: "complex", prompt, input });
    await recordUsage?.({ ...result.usage, costUsd: result.costUsd, estimated: result.estimated });
    const parsed = schema.safeParse(result.json);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new ApiError(502, "AI_OUTPUT_INVALID", `The ${task} answer did not have the expected shape (${first.path.join(".")}: ${first.message}).`);
    }
    return parsed.data;
  }
}

/** Rules §6.4: at most three findings, fixed titles, items sorted by code then level. */
function merge(scope: Flag[], accuracy: Flag[], stateItems: StateItem[], cadre: string, state: string): Finding[] {
  const out: Finding[] = [];
  const codes = (flags: Flag[]) => [...new Set(flags.map((f) => f.code))];
  if (scope.length) {
    const flags = [...scope].sort(byCodeThenLevel);
    out.push({
      check: "context",
      sev: "B",
      title: `Other acts beyond ${cadre} scope`,
      detail: flags.map((f) => f.line).join("\n"),
      refs: codes(flags),
      fix: `Rewrite as "Identifies…, gives the pre-referral care the ${cadre} is authorised for, and refers", or tag the act "verify" against the state ${cadre} job description.`,
      source: "agent",
    });
  }
  if (accuracy.length) {
    const flags = [...accuracy].sort(byCodeThenLevel);
    out.push({
      check: "context",
      sev: "M",
      title: "Clinical or programme facts to correct",
      detail: flags.map((f) => f.line).join("\n"),
      refs: codes(flags),
      fix:
        flags
          .filter((f) => f.correct)
          .map((f) => `${f.code} ${levelName(f.level)}: ${f.correct}`)
          .join("\n") || "Correct each fact against the current national guideline.",
      source: "agent",
    });
  }
  if (stateItems.length) {
    out.push({
      check: "context",
      sev: "m",
      title: `Does not reflect ${state}`,
      detail: stateItems.map((i) => `${i.category}: ${i.item}`).join("\n"),
      refs: [...new Set(stateItems.flatMap((i) => i.refs))],
      fix: `Add what is specific to ${state} to the research state context, then revise the affected competencies.`,
      source: "agent",
    });
  }
  return out;
}

/** Rule-based checks only, no model call. Used by tests that exercise the review engine on its own. */
export class ComputedOnlyReviewer implements AgentReviewer {
  async review(): Promise<Finding[]> {
    return [];
  }
}
