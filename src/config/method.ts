import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Method paragraph for the "Method & Sources" export sheet (spec 7). It must be the prototype's
 * text verbatim (frac-studio.html L653 onward), so it lives in a config file rather than in code.
 * Until that file exists the row is left empty instead of inventing wording.
 */
export function loadMethodParagraph(
  file = process.env.METHOD_PARAGRAPH_PATH ?? path.resolve(process.cwd(), "config/method.txt"),
): string {
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
}
