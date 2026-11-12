import { loadAiProfiles } from "../config/ai-providers.ts";
import { createAi } from "./registry.ts";

const profiles = loadAiProfiles();

describe("AI provider registry", () => {
  it("builds the profile AI_PROVIDER names, with the key from the variable the profile names", async () => {
    const ai = await createAi("claude-mixed", profiles, { ANTHROPIC_API_KEY: "test-key" });
    expect(ai.provider.name).toBe("claude-mixed");
    expect(ai.profile?.kind).toBe("claude");
    expect(ai.mocks).toBeNull();
  });

  it("uses the sample data for mock, with no key", async () => {
    const ai = await createAi("mock", profiles, {});
    expect(ai.provider.name).toBe("mock");
    expect(ai.profile).toBeNull();
    expect(ai.mocks).not.toBeNull();
  });

  it("refuses the mock when the run requires a real provider (dev:ai / start:ai)", async () => {
    await expect(createAi("mock", profiles, {}, true)).rejects.toThrow(/must use a real AI provider.*AI_PROVIDER=mock/);
    const ai = await createAi("claude", profiles, { ANTHROPIC_API_KEY: "test-key" }, true);
    expect(ai.provider.name).toBe("claude");
  });

  it("stops with what to set when the key is missing or blank", async () => {
    await expect(createAi("claude", profiles, {})).rejects.toThrow(/needs ANTHROPIC_API_KEY.*dev:mock/);
    await expect(createAi("claude", profiles, { ANTHROPIC_API_KEY: "  " })).rejects.toThrow(/needs ANTHROPIC_API_KEY/);
  });

  it("lists the valid names when AI_PROVIDER is unknown", async () => {
    await expect(createAi("openai", profiles, {})).rejects.toThrow(/Use one of: mock, claude-mixed, claude-fast, claude/);
  });
});
