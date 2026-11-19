// The contract between FracService.startStep and the Creator step functions (research, roles,
// competencies, ladders): what a step receives, and callModel, the one way a step calls the AI.
// callModel is the step-side wrapper of ask-model.ts (call the TextProvider, record usage/cost, validate with Zod).
import type { ZodType } from "zod/v4";
import type { FracDocument } from "../../models/document.model.ts";
import type { Frac } from "../../models/frac.model.ts";
import type { AiTask, ModelTier, TextProvider } from "../../providers/text/types.ts";
import type { JobProgress, RecordUsage } from "../queue/job-runner.ts";
import { askModel, type AskRequest } from "./ask-model.ts";

/**
 * What every generation step gets: the FRAC as it was when the job started, and the job's hooks.
 * Built by FracService.startStep; `progress` and `recordUsage` come from the JobRunner.
 */
export interface StepContext {
  frac: Frac;
  /** Revise feedback (the Revise button): may change what the step does, e.g. rebuild roles from an uploaded sheet. */
  feedback?: string;
  /**
   * The team's instructions typed before a run: added to every AI call of the job (callModel) without changing which
   * path the step takes, so uploaded sheets and documents are still used. Never reaches the expert check's own calls.
   */
  guidance?: string;
  /** Ladders only: the competencies to (re)write; omitted means every competency without a ladder. */
  codes?: string[];
  /** Research and roles: documents the team attached (brief text, a standard Sources sheet). Empty for the other steps. */
  documents?: FracDocument[];
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
  extra: Pick<AskRequest, "searchMaxUses" | "onCitations"> = {},
): Promise<T> {
  return askModel({ provider: ctx.provider, task, tier, prompt: withTeamDirection(prompt, ctx.feedback, ctx.guidance), input, ...extra }, schema, ctx.recordUsage);
}

/** What still wins over the team's text: facts, legal scope and the answer's shape. Everything else gives way to it. */
const STILL_BINDING = "Only these still win over it: never invent facts, sources, numbers or URLs; never add an act beyond the cadre's legal or programme scope; answer in the JSON shape asked for.";

/** The marker every prompt's closing output instruction starts with (prompts.ts JSON_ONLY). */
const OUTPUT_MARKER = "Answer with this JSON object only";

/**
 * The prompt with the team's feedback and instructions as its first priority (19 Nov 2026: feedback in the middle of
 * the prompt lost to the step's own instructions after it, e.g. "List 12 roles"). The team's text goes first, above
 * the persona and the method, and a check that every point is applied goes just before the output shape, so it is
 * the first and the last thing the model reads. Unchanged when there is neither.
 */
export function withTeamDirection(prompt: string, feedback?: string, guidance?: string): string {
  const points = [feedback?.trim() ? `Feedback on the earlier output:\n${feedback.trim()}` : "",
    guidance?.trim() ? `Instructions for this run:\n${guidance.trim()}` : ""].filter(Boolean);
  if (!points.length) return prompt;
  const head = `TEAM FEEDBACK: FIRST PRIORITY
The team that owns this FRAC wrote this. Apply every point of it. It overrides the default counts, the earlier output, what to keep, and every other instruction below. ${STILL_BINDING} If a point cannot be applied without breaking one of those, apply the rest and say which point and why in the closest free-text field of the answer (for example "verify" or "assumptions").

${points.join("\n\n")}`;
  const check = "Before you answer: go through the TEAM FEEDBACK at the top point by point and make sure the answer applies each one.";
  const at = prompt.lastIndexOf(OUTPUT_MARKER);
  const body = at < 0 ? `${prompt}\n\n${check}` : `${prompt.slice(0, at)}${check}\n\n${prompt.slice(at)}`;
  return `${head}\n\n${body}`;
}
