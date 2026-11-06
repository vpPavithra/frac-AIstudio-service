// A provider for tests that never reach a model call (route, validation and storage tests). It does
// not depend on src/mocks, so those tests keep passing when the mocks folder is deleted.
import type { TextProvider } from "../../src/providers/text/types.ts";

/** Returns a TextProvider that rejects every call, so a test that reaches the model fails loudly. */
export const stubProvider = (): TextProvider => ({
  name: "stub",
  complete: () => Promise.reject(new Error("stubProvider: this test should not call the model")),
});
