// Entry point of the optional mocks folder. The provider registry imports this file at runtime only
// when no ANTHROPIC_API_KEY is set (or AI_PROVIDER=mock), so deleting src/mocks needs no code change.
// Its exports must match MocksModule in src/providers/registry.ts.
import content from "./content/cadres.json" with { type: "json" };
import { MockTextProvider, type MockContent } from "./mock-text-provider.ts";

export { seedMockData } from "./seed.ts";

/** The mock TextProvider, answering from content/cadres.json. */
export const createMockProvider = () => new MockTextProvider(content as MockContent);
