import { ApiError as GeminiApiError } from "@google/genai";
import { ApiError } from "../../utils/response.ts";
import { describeGeminiError, geminiUsage } from "./gemini.ts";

const geminiError = (status: number, message: string) => new GeminiApiError({ status, message });

describe("Gemini provider helpers", () => {
  it("counts thinking as output, tool prompts as input, cached tokens and non-empty search queries", () => {
    const usage = geminiUsage({
      usageMetadata: { promptTokenCount: 1000, toolUsePromptTokenCount: 200, candidatesTokenCount: 300, thoughtsTokenCount: 700, cachedContentTokenCount: 400 },
      candidates: [{ groundingMetadata: { webSearchQueries: ["ANM job description", " "] } }],
    });
    expect(usage).toEqual({ inputTokens: 1200, outputTokens: 1000, thinkingTokens: 700, cacheReadTokens: 400, webSearches: 1 });
  });

  it("treats a missing usage block as zero", () => {
    expect(geminiUsage({})).toEqual({ inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0, webSearches: 0 });
  });

  it("maps API errors to the codes the portal shows", () => {
    const code = (err: unknown) => (describeGeminiError(err, "gemini-3.8-flash") as ApiError).code;
    // Gemini rejects a bad key with 400, not 401
    expect(code(geminiError(400, "API key not valid. Please pass a valid API key."))).toBe("AI_AUTH");
    expect(code(geminiError(403, "Permission denied"))).toBe("AI_AUTH");
    expect(code(geminiError(429, "Resource has been exhausted"))).toBe("AI_BUSY");
    expect(code(geminiError(404, "models/x is not found"))).toBe("AI_REQUEST_REJECTED");
    expect(code(geminiError(400, "Invalid JSON payload"))).toBe("AI_REQUEST_REJECTED");
    expect(code(geminiError(503, "overloaded"))).toBe("AI_UNAVAILABLE");
    expect((describeGeminiError(geminiError(503, "high demand"), "gemini-3.8-flash") as ApiError).message).toContain('"gemini-3.8-flash" is unavailable right now (HTTP 503)');
  });

  it("passes other errors through unchanged", () => {
    const timeout = new Error("timed out");
    expect(describeGeminiError(timeout, "m")).toBe(timeout);
  });
});
