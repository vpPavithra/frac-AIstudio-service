import type { ZodType, ZodTypeDef } from "zod";
import { REVIEW } from "../config/constants.ts";
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
// "Vidya" is a persona inside the prompts (services/ai/prompts.ts), not a separate service.
//
// Flow: ReviewService.review calls ChecklistReviewer.review after computeChecks and before buildReport.
// Calls go through the TextProvider on the complex tier (Claude Sonnet 5.5, or the mock with no API key).
// Batch size, parallel calls, max state items and minimum quote words come from REVIEW in
// config/constants.ts (config/service.json REVIEW_BATCH_SIZE, REVIEW_BATCH_PARALLEL,
// REVIEW_MAX_STATE_ITEMS, REVIEW_MIN_QUOTE_WORDS).

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

/**
 * Rules §6.3: makes a model quote and the file text comparable. Lowercase, strip quotes, dashes to spaces,
 * drop other punctuation, collapse whitespace.
 */
export function normaliseQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/["'“”‘’`]/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Rules §6.3 quote check. The level whose text contains the quote (0 = definition), or null when the quote
 * is shorter than REVIEW.minQuoteWords or is not in that competency's text. A null drops the flag, which is
 * what stops the model inventing problems the file does not contain.
 */
export function locateQuote(quote: string, model: ReviewModel, code: string): number | null {
  const q = normaliseQuote(quote);
  if (q.split(" ").length < REVIEW.minQuoteWords) return null;
  const comp = model.competencies.find((c) => c.code === code);
  if (!comp) return null;
  return competencyTexts(comp).find((t) => normaliseQuote(t.text).includes(q))?.level ?? null;
}

/** One verified AI flag, already formatted as a line of the merged finding's detail. */
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

/** Rules §6.2: no state, "national" or "India" means no state-fit call. */
const isNational = (state?: string) => !state || /national|^india$/i.test(state.trim());

/** Calls the provider (Claude, or the mock without an API key) on the fixed checklist. */
export class ChecklistReviewer implements AgentReviewer {
  constructor(private readonly provider: TextProvider) {}

  async review(input: AgentReviewInput): Promise<Finding[]> {
    const { model, cadre, state, checks, rules } = input;
    const laddered = model.competencies.filter(hasLadder);
    const scopeHitText = (codes: string[]) =>
      checks.scopeHits.filter((h) => codes.includes(h.code)).map((h) => `${h.code} ${levelName(h.level)}: ${h.rule} — "${h.quote}"`);

    // Q1 + Q2 per laddered competency (rules §6.1), REVIEW.checklistBatchSize per call and
    // REVIEW.checklistParallel calls at once. Each prompt lists that batch's code scope hits as "do NOT repeat".
    const items = await runInBatches(
      laddered,
      REVIEW.checklistBatchSize,
      REVIEW.checklistParallel,
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

    // Verification in code (rules §6.3): the quote must be in that competency, and not already covered by a rule.
    // overlapsRule: the quote matches an OUTDATED pattern or a ladder rule marked `suppressesAiFlags` in config
    // (rules 2 and 3 of §4.3). Only rules that apply to this cadre count: a frontline-only rule never runs for
    // other cadres, so it must not drop their AI flags either. onlyIfAbsent / unlessNear are file-level
    // conditions and are not re-tested on a single quote: any pattern match is left to the rule-based check.
    // codeScope: a scope flag on a competency level a code scope rule already hit is a duplicate
    const frontline = checks.family !== null;
    const applies = (r: { frontlineOnly?: boolean }) => frontline || !r.frontlineOnly;
    const overlapsRule = (quote: string) =>
      rules.outdated.filter(applies).some((p) => regex(p.pattern, p.flags.replace("g", "")).test(quote)) ||
      rules.ladder.filter((r) => r.suppressesAiFlags && applies(r)).some((r) => regex(r.pattern, r.flags).test(quote));
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

    // Q3 state fit (rules §6.2, §6.3 item 4), only for a named state: one call on the whole serialized FRAC.
    // Unknown categories are dropped, the first REVIEW.maxStateItems are kept, then sorted by category and text
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
        .slice(0, REVIEW.maxStateItems)
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

/**
 * Rules §6.4: at most three findings, fixed titles, items sorted by code then level, all `source: "agent"`.
 * "Other acts beyond {cadre} scope" (B) from Q1, "Clinical or programme facts to correct" (M) from Q2,
 * "Does not reflect {state}" (m) from Q3.
 */
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
