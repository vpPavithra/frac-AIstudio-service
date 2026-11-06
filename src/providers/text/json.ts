// Shared by every real provider: pulls the one JSON object out of a model's final text. The steps'
// Zod schemas validate it; null makes the step fail with AI_OUTPUT_INVALID (the spend is still recorded).

/**
 * The JSON object in the model's final text. Tolerates a ```json fence or a sentence before it
 * (web search answers sometimes add one). Returns null when there is none, so the step's schema
 * check fails with AI_OUTPUT_INVALID and the spend is still recorded.
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}
