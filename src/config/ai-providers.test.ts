import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAiProfiles } from "./ai-providers.ts";
import { SettingsError } from "./settings.ts";

function tempProfiles(body: unknown): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ai-providers-")), "ai-providers.json");
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
}

const valid = {
  kind: "gemini",
  keyEnv: "GEMINI_API_KEY",
  models: { complex: "m1", default: "m2" },
  thinking: { complex: "high", default: "low" },
  rates: { complex: { inUsdPer1M: 1, outUsdPer1M: 2, cacheReadUsdPer1M: 0.1 }, default: { inUsdPer1M: 1, outUsdPer1M: 2, cacheReadUsdPer1M: 0.1 } },
};

describe("AI provider profiles", () => {
  it("reads the committed profiles: Gemini free and paid, and Claude", () => {
    const profiles = loadAiProfiles();
    expect(Object.keys(profiles)).toEqual(["gemini-free", "gemini-paid", "claude"]);
    expect(profiles["gemini-free"]).toMatchObject({ kind: "gemini", keyEnv: "GEMINI_API_KEY", freeTier: true, webSearch: false, maxConcurrent: 1 });
    expect(profiles.claude).toMatchObject({ kind: "claude", keyEnv: "ANTHROPIC_API_KEY", freeTier: false });
  });

  it("fills defaults and skips comment keys", () => {
    const p = loadAiProfiles(tempProfiles({ "//": "note", mine: { ...valid, "//": "inner note" } })).mine;
    expect(p).toMatchObject({ name: "mine", freeTier: false, webSearch: false, rates: { cacheWriteMultiplier: 1, webSearchUsdPer1K: 0 } });
  });

  it("names the profile and field at fault", () => {
    expect(() => loadAiProfiles(tempProfiles({ bad: { ...valid, kind: "other" } }))).toThrow(SettingsError);
    expect(() => loadAiProfiles(tempProfiles({ bad: { ...valid, thinking: { complex: "max", default: "low" } } }))).toThrow(/"bad" thinking.complex/);
    expect(() => loadAiProfiles(tempProfiles({ bad: { ...valid, keyEnv: "GEMINI_KEY" } }))).toThrow(/_API_KEY/);
  });

  it("keeps the name mock for the sample-data provider", () => {
    expect(() => loadAiProfiles(tempProfiles({ mock: valid }))).toThrow(/reserved/);
  });
});
