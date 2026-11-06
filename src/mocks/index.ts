// Entry point of the optional mocks folder. The provider registry imports this file at runtime only
// when AI_PROVIDER=mock (`npm run dev:mock`), so deleting src/mocks needs no code change.
// Its exports must match MocksModule in src/providers/registry.ts.
import { loadAiProfiles } from "../config/ai-providers.ts";
import { MOCK } from "../config/constants.ts";
import { SettingsError } from "../config/settings.ts";
import content from "./content/cadres.json" with { type: "json" };
import { MockTextProvider, type MockContent } from "./mock-text-provider.ts";

export { seedMockData } from "./seed.ts";

/** The mock TextProvider, answering from content/cadres.json and pricing its estimate as MOCK_PRICED_AS. */
export function createMockProvider(): MockTextProvider {
  const profile = loadAiProfiles()[MOCK.pricedAs];
  if (!profile) {
    throw new SettingsError(`MOCK_PRICED_AS="${MOCK.pricedAs}" is not a profile in config/ai-providers.json.`);
  }
  return new MockTextProvider(content as MockContent, profile.rates);
}
