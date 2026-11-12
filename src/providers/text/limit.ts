// Caps how many calls a provider has in flight across every job, for keys with a low requests-per-minute
// quota (a profile's `maxConcurrent`). Applied by registry.ts. The steps'
// own batching (AI_BATCH_PARALLEL, REVIEW_BATCH_PARALLEL) still decides the order; extra calls just wait.
import type { CompletionRequest, CompletionResult, TextProvider } from "./types.ts";

/** Wraps `provider` so at most `max` complete() calls run at once; the rest queue in arrival order. */
export function limitConcurrency(provider: TextProvider, max: number): TextProvider {
  let active = 0;
  const waiting: (() => void)[] = [];
  // A finished call hands its slot straight to the next waiter, so a new arrival cannot take it in between
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  return {
    name: provider.name,
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const asked = Date.now();
      if (active < max) active++;
      else await new Promise<void>((resolve) => waiting.push(resolve));
      const queuedMs = Date.now() - asked;
      try {
        // The wait is reported so askModel records the model's own time, not the queue's
        return { ...(await provider.complete(request)), queuedMs };
      } finally {
        release();
      }
    },
  };
}
