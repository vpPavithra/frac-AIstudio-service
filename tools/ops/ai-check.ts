// `npm run ai:check`: one tiny real call to the provider AI_PROVIDER names, to prove the key, the model
// ids and the quota before running a whole FRAC. Prints the model, tokens and cost; exits 1 with the
// coded error otherwise. Costs a few hundred tokens (nothing on a free tier). With AI_PROVIDER=mock it
// says so and makes no call.
import "dotenv/config";
import { createAi } from "../../src/providers/registry.ts";
import type { ModelTier } from "../../src/providers/text/types.ts";
import { ApiError } from "../../src/utils/response.ts";

const PROMPT = 'Reply with exactly this JSON object and nothing else: {"ok": true}';

/** Calls each tier once (they can be different models) and returns the exit code. */
async function main(): Promise<number> {
  const { provider, profile } = await createAi();
  if (!profile) {
    process.stdout.write(`AI_PROVIDER is "${provider.name}": the sample-data mock answers; no model to check.\n`);
    return 0;
  }
  for (const tier of ["complex", "default"] as ModelTier[]) {
    const r = await provider.complete({ task: "roles", tier, prompt: PROMPT, input: {} });
    const ok = (r.json as { ok?: unknown } | null)?.ok === true;
    const cost = `${r.estimated ? "est. " : ""}$${r.costUsd.toFixed(6)}`;
    process.stdout.write(
      `${ok ? "✓" : "✗"} ${profile.name} ${tier}: ${r.model} · ${r.usage.inputTokens} in · ${r.usage.outputTokens} out · ${cost}\n`,
    );
    if (!ok) {
      process.stderr.write(`  The answer was not the expected JSON: ${JSON.stringify(r.json)}\n`);
      return 1;
    }
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    const message = err instanceof ApiError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
    process.stderr.write(`✗ ${message}\n`);
    process.exitCode = 1;
  });
