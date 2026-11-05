import type { Frac, FracCompetency, Level } from "../../models/frac.model.ts";
import { JOB_MESSAGES } from "../queue/job-messages.ts";
import { runInBatches } from "./batching.ts";
import { laddersPrompt } from "./prompts.ts";
import { laddersOutput } from "./schemas.ts";
import { BATCH } from "./sizes.ts";
import { callModel, type StepContext } from "./step-context.ts";

/** Writes ladders into the competencies by code; competencies not in `ladders` are left as they are. */
export function withLadders(competencies: FracCompetency[], ladders: Map<string, Level[]>): FracCompetency[] {
  return competencies.map((c) => (ladders.has(c.code) ? { ...c, levels: ladders.get(c.code) ?? null } : c));
}

/**
 * Step 5, level ladders (Kaushal + Vidya), default tier, 4 competencies per call, 3 in parallel;
 * saves after each batch and reports "x of y competencies" (spec 5.5). `codes` limits it to those
 * competencies ("Revise {code}", "Fix these competencies"); otherwise every competency without a ladder.
 */
export async function runLadders(ctx: StepContext): Promise<Partial<Frac>> {
  const { frac, feedback } = ctx;
  const wanted = ctx.codes?.length ? new Set(ctx.codes) : null;
  const targets = frac.competencies.filter((c) => (wanted ? wanted.has(c.code) : c.levels === null));
  const written = new Map<string, Level[]>();

  await ctx.progress(JOB_MESSAGES.ladders(targets.length), 0, targets.length);
  await runInBatches(
    targets,
    BATCH.size,
    BATCH.parallel,
    async (batch) => {
      const codes = batch.map((c) => c.code);
      const out = await callModel(ctx, "ladders", "default", laddersPrompt(frac, codes, feedback),
        { competencies: batch.map((c) => ({ code: c.code, label: c.label, type: c.type, description: c.description })), feedback },
        laddersOutput);
      return out.ladders.filter((l) => codes.includes(l.code));
    },
    async (ladders, done) => {
      ladders.forEach((l) => written.set(l.code, l.levels));
      await ctx.save((latest) => ({ competencies: withLadders(latest.competencies, written) }));
      await ctx.progress(JOB_MESSAGES.ladders(targets.length), done, targets.length);
    },
  );
  return {};
}
