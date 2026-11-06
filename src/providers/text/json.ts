// Shared by every real provider: pulls the one JSON object out of a model's final text. The steps'
// Zod schemas validate it; null makes askModel retry once, then fail the step with AI_OUTPUT_INVALID
// (the spend is still recorded). jsonProblem explains a null for the log.
//
// Tolerates what models actually send: a ```json fence, a sentence before or after the object, braces
// inside strings, raw line breaks or tabs inside strings, and trailing commas. It does not guess at
// anything else (an unescaped quote inside a string stays a failure), so a bad answer is never "fixed"
// into different content.

/** How many `{` positions to try before giving up (a long preamble can contain braces). */
const MAX_STARTS = 8;

/**
 * The balanced {...} starting at `start`, read string-aware so braces inside strings do not count.
 * Null when the object never closes (the answer was cut off or is not JSON).
 */
function balancedObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** Escapes raw control characters inside strings and drops trailing commas: the two slips JSON.parse rejects most. */
function repair(candidate: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of candidate) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      else if (ch === "\n") {
        out += "\\n";
        continue;
      } else if (ch === "\r") {
        out += "\\r";
        continue;
      } else if (ch === "\t") {
        out += "\\t";
        continue;
      }
    } else if (ch === '"') inString = true;
    out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/** Every {...} candidate in the text, fenced block first, in order. */
function candidates(text: string): string[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const bodies = fenced ? [fenced[1], text] : [text];
  const out: string[] = [];
  for (const body of bodies) {
    let from = 0;
    for (let n = 0; n < MAX_STARTS; n++) {
      const start = body.indexOf("{", from);
      if (start < 0) break;
      const obj = balancedObject(body, start);
      if (obj) out.push(obj);
      from = start + 1;
    }
  }
  return out;
}

const tryParse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

/**
 * The JSON object in the model's final text, or null when there is none. The first candidate that parses
 * (as is, then repaired) wins; arrays and primitives are not accepted, every step expects an object.
 */
export function extractJson(text: string): unknown {
  for (const c of candidates(text)) {
    const parsed = tryParse(c) ?? tryParse(repair(c));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  }
  return null;
}

/** Why extractJson returned null, for the log: the parse error and the text around it. */
export function jsonProblem(text: string): string {
  if (!text.trim()) return "the answer was empty";
  const first = candidates(text)[0];
  if (!first) return `no complete {...} object in the answer (starts: ${JSON.stringify(text.slice(0, 120))})`;
  try {
    JSON.parse(repair(first));
    return "the JSON is not an object";
  } catch (err) {
    const message = (err as Error).message;
    const at = Number(/position (\d+)/.exec(message)?.[1] ?? NaN);
    const around = Number.isFinite(at) ? ` near ${JSON.stringify(repair(first).slice(Math.max(0, at - 60), at + 60))}` : "";
    return `${message}${around}`;
  }
}
