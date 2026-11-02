import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PATHS } from "./constants.ts";

/**
 * Method paragraph for the "Method & Sources" export sheet (spec 7). It must be the prototype's
 * text verbatim (frac-studio.html L653 onward), so it lives in a config file rather than in code.
 * Until that file exists the row is left empty instead of inventing wording.
 */
export function loadMethodParagraph(file = path.resolve(process.cwd(), PATHS.methodParagraph)): string {
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
}
