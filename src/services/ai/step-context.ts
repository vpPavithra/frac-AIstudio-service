import type { ZodType, ZodTypeDef } from "zod";
import type { Frac } from "../../models/frac.model.ts";
import type { AiTask, ModelTier, TextProvider } from "../../providers/text/types.ts";
import { ApiError } from "../../utils/response.ts";
import type { JobProgress, RecordUsage } from "../queue/job-runner.ts";

/** What every generation step gets: the FRAC as it was when the job started, and the job's hooks. */
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
 * One model call: records its spend on the job first (so a bad answer is still billed, spec gap 1),
 * then validates the JSON against the step's output shape.
 */
export async function callModel<T>(
  ctx: StepContext,
  task: AiTask,
  tier: ModelTier,
  prompt: string,
  input: unknown,
  schema: ZodType<T, ZodTypeDef, unknown>,
): Promise<T> {
  const result = await ctx.provider.complete({ task, tier, prompt, input });
  await ctx.recordUsage({ ...result.usage, costUsd: result.costUsd, estimated: result.estimated });
  const parsed = schema.safeParse(result.json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ApiError(502, "AI_OUTPUT_INVALID", `The ${task} answer did not have the expected shape (${first.path.join(".")}: ${first.message}).`);
  }
  return parsed.data;
}
