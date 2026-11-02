import { z } from "zod";

/** Empty strings from multipart form fields mean "not given". */
const optionalField = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => s || undefined);

/** POST /frac-reviews form fields beside the file (spec 6.2, all optional). */
export const reviewContextSchema = z.object({
  cadre: optionalField(200),
  state: optionalField(200),
  notes: optionalField(5000),
});
export type ReviewContextInput = z.infer<typeof reviewContextSchema>;
