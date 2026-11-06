import { limitConcurrency } from "./limit.ts";
import type { CompletionRequest, TextProvider } from "./types.ts";

const request: CompletionRequest = { task: "ladders", tier: "default", prompt: "p", input: {} };

describe("limitConcurrency", () => {
  it("never runs more than `max` calls at once and finishes every call", async () => {
    let active = 0;
    let peak = 0;
    const slow: TextProvider = {
      name: "slow",
      async complete() {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return { json: {}, model: "m", usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0 };
      },
    };
    const limited = limitConcurrency(slow, 2);
    const results = await Promise.all(Array.from({ length: 7 }, () => limited.complete(request)));
    expect(results).toHaveLength(7);
    expect(peak).toBe(2);
    expect(limited.name).toBe("slow");
  });

  it("frees the slot when a call fails", async () => {
    const failing: TextProvider = { name: "f", complete: () => Promise.reject(new Error("boom")) };
    const limited = limitConcurrency(failing, 1);
    await expect(limited.complete(request)).rejects.toThrow("boom");
    await expect(limited.complete(request)).rejects.toThrow("boom");
  });
});
