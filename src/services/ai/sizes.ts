// Per-run sizing for the Creator steps: how many roles, activities and competencies to ask for (by brief size)
// and how the batched steps (activities, ladders) split their calls. Read once at startup; changing
// config/frac-sizes.json or AI_BATCH_SIZE / AI_BATCH_PARALLEL needs a restart.
import { AI } from "../../config/constants.ts";
import { loadFracSizes } from "../../config/frac-sizes.ts";

/**
 * Spec 5.1 brief sizes, read once at startup from config/frac-sizes.json (FRAC_SIZES_CONFIG_PATH overrides).
 * A missing or invalid table stops startup (see config/frac-sizes.ts).
 */
export const SIZE_TARGETS = loadFracSizes();

/** Spec 5.3b / 5.5: items per model call and calls in flight at once (AI_BATCH_SIZE, AI_BATCH_PARALLEL). */
export const BATCH = { size: AI.stepBatchSize, parallel: AI.stepParallel } as const;
