// What a model call costs at Claude list prices (spec 9: log tokens and cost per job). Rates live in
// config/service.json. Both providers use this: Claude for the real bill, the mock for an estimate of
// what the same call would cost on Claude.
import { RATES } from "../../config/constants.ts";
import type { CallUsage, ModelTier } from "./types.ts";

/** Cache writes (5-minute TTL) bill at 1.25x the input rate. */
const CACHE_WRITE_MULTIPLIER = 1.25;

const rate = (tier: ModelTier) =>
  tier === "complex"
    ? { inUsd: RATES.complexInUsdPer1M, outUsd: RATES.complexOutUsdPer1M, cacheReadUsd: RATES.complexCacheReadUsdPer1M }
    : { inUsd: RATES.defaultInUsdPer1M, outUsd: RATES.defaultOutUsdPer1M, cacheReadUsd: RATES.defaultCacheReadUsdPer1M };

/**
 * USD for one call. `inputTokens` is every input token; the cached part of it (reads and writes) is
 * priced at its own rate, and each web search adds the per-search fee.
 */
export function priceUsd(tier: ModelTier, usage: CallUsage): number {
  const r = rate(tier);
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const uncached = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);
  const tokens = uncached * r.inUsd + cacheWrite * r.inUsd * CACHE_WRITE_MULTIPLIER + cacheRead * r.cacheReadUsd + usage.outputTokens * r.outUsd;
  return tokens / 1_000_000 + ((usage.webSearches ?? 0) * RATES.webSearchUsdPer1K) / 1_000;
}
