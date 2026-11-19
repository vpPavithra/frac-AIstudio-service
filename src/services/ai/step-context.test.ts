import { z } from "zod/v4";
import type { CompletionRequest, TextProvider } from "../../providers/text/types.ts";
import type { Frac } from "../../models/frac.model.ts";
import { callModel, withTeamDirection, type StepContext } from "./step-context.ts";

const shape = z.object({ ok: z.boolean() });

/** A provider that records the prompt of every call. */
function recording() {
  const prompts: string[] = [];
  const provider: TextProvider = {
    name: "claude",
    complete: async (req: CompletionRequest) => {
      prompts.push(req.prompt);
      return { json: { ok: true }, model: "claude-sonnet-5-5", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, costUsd: 0, estimated: true };
    },
  };
  return { prompts, provider };
}

const ctxWith = (provider: TextProvider, guidance?: string, feedback?: string): StepContext => ({
  frac: {} as Frac,
  guidance,
  feedback,
  provider,
  progress: async () => undefined,
  recordUsage: async () => undefined,
  save: async () => ({}) as Frac,
});

describe("withTeamDirection", () => {
  const PROMPT = "PERSONA\n\nList 12 roles.\n\nAnswer with this JSON object only, no prose:\n{}";

  it("leaves the prompt unchanged with no feedback or instructions, or blank ones", () => {
    expect(withTeamDirection(PROMPT)).toBe(PROMPT);
    expect(withTeamDirection(PROMPT, "  ", "   ")).toBe(PROMPT);
  });

  it("puts the feedback first, as the top priority over the step's own instructions", () => {
    const out = withTeamDirection(PROMPT, "  Only 6 roles ");
    expect(out.startsWith("TEAM FEEDBACK: FIRST PRIORITY")).toBe(true);
    expect(out).toContain("overrides the default counts");
    expect(out).toContain("never invent facts");
    expect(out.indexOf("Only 6 roles")).toBeLessThan(out.indexOf("PERSONA"));
  });

  it("checks every point again just before the output shape, which stays last", () => {
    const out = withTeamDirection(PROMPT, undefined, "Keep activity wording short");
    const check = out.indexOf("Before you answer");
    expect(check).toBeGreaterThan(out.indexOf("List 12 roles."));
    expect(check).toBeLessThan(out.indexOf("Answer with this JSON object only"));
    expect(out.endsWith("{}")).toBe(true);
  });

  it("carries both the revise feedback and the run's instructions", () => {
    const out = withTeamDirection(PROMPT, "Add the 104 helpline", "Use state scheme names");
    expect(out).toContain("Feedback on the earlier output:\nAdd the 104 helpline");
    expect(out).toContain("Instructions for this run:\nUse state scheme names");
  });

  it("adds the check at the end of a prompt with no output shape", () => {
    expect(withTeamDirection("PLAIN", "Shorter").endsWith("make sure the answer applies each one.")).toBe(true);
  });
});

describe("callModel", () => {
  it("sends the step's guidance with every call it makes", async () => {
    const { prompts, provider } = recording();
    const ctx = ctxWith(provider, "Keep activity wording short");
    await callModel(ctx, "roles", "complex", "FIRST", {}, shape);
    await callModel(ctx, "mapping", "default", "SECOND", {}, shape);
    expect(prompts).toHaveLength(2);
    expect(prompts.every((p) => p.startsWith("TEAM FEEDBACK: FIRST PRIORITY") && p.includes("Keep activity wording short"))).toBe(true);
    expect(prompts[0]).toContain("FIRST");
    expect(prompts[1]).toContain("SECOND");
  });

  it("sends the revise feedback first too", async () => {
    const { prompts, provider } = recording();
    await callModel(ctxWith(provider, undefined, "Only 6 roles"), "roles", "complex", "ONLY", {}, shape);
    expect(prompts[0].startsWith("TEAM FEEDBACK: FIRST PRIORITY")).toBe(true);
    expect(prompts[0]).toContain("Only 6 roles");
  });

  it("sends the prompt as written when the step has no guidance", async () => {
    const { prompts, provider } = recording();
    await callModel(ctxWith(provider), "roles", "complex", "ONLY", {}, shape);
    expect(prompts).toEqual(["ONLY"]);
  });
});
