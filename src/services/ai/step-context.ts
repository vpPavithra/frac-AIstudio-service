// The contract between FracService.startStep and the Creator step functions (research, roles,
// competencies, ladders): what a step receives, and callModel, the one way a step calls the AI.
// callModel is the step-side wrapper of ask-model.ts (call the TextProvider, record usage/cost, validate with Zod).
import type { ZodType } from "zod/v4";
import type { Frac } from "../../models/frac.model.ts";
import type { AiTask, ModelTier, TextProvider } from "../../providers/text/types.ts";
import type { JobProgress, RecordUsage } from "../queue/job-runner.ts";
import { askModel } from "./ask-model.ts";

/**
 * What every generation step gets: the FRAC as it was when the job started, and the job's hooks.
 * Built by FracService.startStep; `progress` and `recordUsage` come from the JobRunner.
 */
export interface StepContext {
  frac: Frac;
  feedback?: string;
  /** Ladders only: the competencies to (re)write; omitted means every competency without a ladder. */
  codes?: string[];
  provider: TextProvider;
  progress: JobProgress;
  recordUsage: RecordUsage;
  /**
   * Saves now: `update` receives the latest saved FRAC (team edits included) and returns the fields
   * to change. Ladders save after each batch this way (spec 5.5).
   */
  save(update: (latest: Frac) => Partial<Frac>): Promise<Frac>;
}

/**
 * One model call for a Creator step, through askModel: spend and the per-call record are written first
 * (so a bad answer is still billed), then the answer is validated. A shape error fails the job with
 * AI_OUTPUT_INVALID; provider errors (AI_AUTH, AI_BUSY, AI_REFUSED, AI_OUTPUT_TRUNCATED…) pass through.
 */
export function callModel<T>(
  ctx: StepContext,
  task: AiTask,
  tier: ModelTier,
  prompt: string,
  input: unknown,
  schema: ZodType<T>,
): Promise<T> {
  return askModel({ provider: ctx.provider, task, tier, prompt, input }, schema, ctx.recordUsage);
}
