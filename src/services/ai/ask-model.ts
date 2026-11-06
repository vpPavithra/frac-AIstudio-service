// The one way any AI caller (Creator steps via callModel, the review checklist) talks to the provider:
// call it, time it, validate the answer with the step's Zod schema, and report every call through
// recordUsage, with its outcome, so the job total and the per-call log (ai_calls) both see it.
// A wrong-shape or unreadable answer is asked again LLM.invalidRetries times (default 1) before the step
// fails with AI_OUTPUT_INVALID; each attempt is billed and logged, and the reason goes to the log.
// A provider error (AI_BUSY, AI_AUTH, ...) is reported with no tokens and rethrown, never retried here:
// the SDKs already retry transport errors.
import type { ZodType } from "zod/v4";
import { LLM } from "../../config/constants.ts";
import { jsonProblem } from "../../providers/text/json.ts";
import type { AiTask, CompletionResult, ModelTier, TextProvider } from "../../providers/text/types.ts";
import { logger } from "../../utils/logger.ts";
import { ApiError } from "../../utils/response.ts";
import type { RecordUsage } from "../queue/job-runner.ts";

/** What one call needs: the provider, the task and tier, the prompt, the structured input for the mock. */
export interface AskRequest {
  provider: TextProvider;
  task: AiTask;
  tier: ModelTier;
  prompt: string;
  input: unknown;
}

/** Why an answer was rejected, for the log: unreadable JSON, or the first schema issue. */
function rejection(result: CompletionResult, issue: { path: PropertyKey[]; message: string }): string {
  if (result.json === null) return result.text === undefined ? "no JSON in the answer" : `no readable JSON: ${jsonProblem(result.text)}`;
  return `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`;
}

/**
 * One validated model call. Spend is recorded for every attempt, even a rejected one (spec gap 1). Throws
 * AI_OUTPUT_INVALID (502) naming the first bad path after the last attempt; provider errors pass through.
 */
export async function askModel<T>(req: AskRequest, schema: ZodType<T>, recordUsage?: RecordUsage): Promise<T> {
  const base = { provider: req.provider.name, task: req.task, tier: req.tier };
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    let result: CompletionResult;
    try {
      result = await req.provider.complete({ task: req.task, tier: req.tier, prompt: req.prompt, input: req.input, schema });
    } catch (err) {
      const outcome = err instanceof ApiError ? err.code : "ERROR";
      await recordUsage?.({
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        call: { ...base, model: "", outcome, latencyMs: Date.now() - started, cacheReadTokens: 0 },
      });
      throw err;
    }
    const parsed = schema.safeParse(result.json);
    await recordUsage?.({
      ...result.usage,
      costUsd: result.costUsd,
      estimated: result.estimated,
      call: {
        ...base,
        model: result.model,
        outcome: parsed.success ? "ok" : "invalid",
        // The model's own time: a wait for a free slot (limitConcurrency) is not counted
        latencyMs: Math.max(0, Date.now() - started - (result.queuedMs ?? 0)),
        cacheReadTokens: result.usage.cacheReadTokens ?? 0,
      },
    });
    if (parsed.success) return parsed.data;

    const first = parsed.error.issues[0];
    const retry = attempt < LLM.invalidRetries;
    logger.warn("AI answer rejected", { provider: base.provider, model: result.model, task: req.task, attempt: attempt + 1, retry, reason: rejection(result, first) });
    if (!retry) {
      const where = result.json === null ? "no readable JSON" : `${first.path.map(String).join(".")}: ${first.message}`;
      throw new ApiError(502, "AI_OUTPUT_INVALID", `The ${req.task} answer did not have the expected shape (${where}).`);
    }
  }
}

