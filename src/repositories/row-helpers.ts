// Small helpers shared by the Postgres and in-memory repositories.

/** Deep copy so callers can never mutate what a memory store holds. */
export const clone = <T>(value: T): T => structuredClone(value);
/** Sort comparator: newest `at` first. */
export const byNewest = (a: { at: string }, b: { at: string }) => b.at.localeCompare(a.at);
/** pg returns TIMESTAMPTZ as Date; the API carries ISO strings. */
export const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : v);
