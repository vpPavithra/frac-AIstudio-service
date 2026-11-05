/** A–Z only, at most 4 characters, fallback "C" (spec 4.1 FRAC.codePrefix). */
export function sanitizeCodePrefix(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) || "C";
}
