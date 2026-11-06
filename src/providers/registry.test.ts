import { loadAiProfiles } from "../config/ai-providers.ts";
import { createAi } from "./registry.ts";

const profiles = loadAiProfiles();

describe("AI provider registry", () => {
  it("builds the profile AI_PROVIDER names, with the key from the variable the profile names", async () => {
    const ai = await createAi("gemini-free", profiles, { GEMINI_API_KEY: "test-key" });
    expect(ai.provider.name).toBe("gemini-free");
    expect(ai.profile?.kind).toBe("gemini");
    expect(ai.mocks).toBeNull();
    const claude = await createAi("claude", profiles, { ANTHROPIC_API_KEY: "test-key" });
    expect(claude.provider.name).toBe("claude");
  });

  it("uses the sample data for mock, with no key", async () => {
    const ai = await createAi("mock", profiles, {});
    expect(ai.provider.name).toBe("mock");
    expect(ai.profile).toBeNull();
    expect(ai.mocks).not.toBeNull();
  });

  it("stops with what to set when the key is missing or blank", async () => {
    await expect(createAi("gemini-free", profiles, {})).rejects.toThrow(/needs GEMINI_API_KEY.*dev:mock/);
    await expect(createAi("claude", profiles, { ANTHROPIC_API_KEY: "  " })).rejects.toThrow(/needs ANTHROPIC_API_KEY/);
  });

  it("lists the valid names when AI_PROVIDER is unknown", async () => {
    await expect(createAi("openai", profiles, {})).rejects.toThrow(/Use one of: mock, gemini-free, gemini-paid, claude/);
  });
});
