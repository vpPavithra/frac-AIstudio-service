// What a model call costs at a provider's list prices (spec 9: log tokens and cost per job). The prices
// come from the active profile in config/ai-providers.json (`rates`), so every provider is priced the
// same way. Real providers use it for the bill (or, on a free tier, the paid-tier estimate); the mock
// uses the MOCK_PRICED_AS profile to preview that bill. The total lands on the job's `usage` via callModel.
import type { ProviderRates } from "../../config/ai-providers.ts";
import type { CallUsage, ModelTier } from "./types.ts";

/**
 * USD for one call. `inputTokens` is every input token; the cached part of it (reads and writes) is
 * priced at its own rate, and each web search adds the per-search fee.
 */
export function priceUsd(rates: ProviderRates, tier: ModelTier, usage: CallUsage): number {
  const r = rates[tier];
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const uncached = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);
  const tokens =
    uncached * r.inUsdPer1M + cacheWrite * r.inUsdPer1M * rates.cacheWriteMultiplier + cacheRead * r.cacheReadUsdPer1M + usage.outputTokens * r.outUsdPer1M;
  return tokens / 1_000_000 + ((usage.webSearches ?? 0) * rates.webSearchUsdPer1K) / 1_000;
}
