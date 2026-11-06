// Code-prefix helper shared by the Creator: the letters that start every competency code (e.g. "ANM" in
// "ANM3"). Called by services/frac.service.ts (PATCH) and services/ai/research.step.ts (research output).
/** A–Z only, at most 4 characters, fallback "C" (spec 4.1 FRAC.codePrefix). */
export function sanitizeCodePrefix(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) || "C";
}
