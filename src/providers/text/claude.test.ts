import { extractJson } from "./json.ts";
import { loadAiProfiles } from "../../config/ai-providers.ts";
import { priceUsd } from "./pricing.ts";

const claude = loadAiProfiles().claude.rates;

describe("Claude provider helpers", () => {
  it("extracts the JSON object from plain, fenced or prefixed text", () => {
    expect(extractJson('{"roles":[{"title":"A"}]}')).toEqual({ roles: [{ title: "A" }] });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here is the research I found.\n{"cadreFull":"ANM"}')).toEqual({ cadreFull: "ANM" });
  });

  it("returns null when there is no valid JSON, so the step reports AI_OUTPUT_INVALID", () => {
    expect(extractJson("I could not find a JD.")).toBeNull();
    expect(extractJson('{"roles": [')).toBeNull();
  });

  it("prices calls by tier from the configured rates", () => {
    // ai-providers.json: Claude Sonnet 5.5 on both tiers, $2 / $10 per million tokens
    expect(priceUsd(claude, "complex", { inputTokens: 1_000_000, outputTokens: 100_000 })).toBeCloseTo(3);
    expect(priceUsd(claude, "default", { inputTokens: 500_000, outputTokens: 50_000 })).toBeCloseTo(1.5);
  });

  it("prices cache reads and writes at their own rates and adds the web search fee", () => {
    // 1M input of which 600K cache reads ($0.20) and 200K cache writes (1.25 x $2); 5 searches at $10 per 1,000
    const usd = priceUsd(claude, "complex", { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 600_000, cacheWriteTokens: 200_000, webSearches: 5 });
    expect(usd).toBeCloseTo(0.2 * 2 + 0.6 * 0.2 + 0.2 * 2 * 1.25 + 0.05);
  });
});
