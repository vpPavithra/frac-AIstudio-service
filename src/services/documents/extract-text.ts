// Turns an uploaded job description or government order into plain text for the research step (review
// decisions, Nov 2026). PDF through unpdf, Word (.docx) through mammoth, .txt/.md as UTF-8. Runs in memory;
// the file is never written to disk or stored. The text is capped at DOCUMENTS.maxChars.
import mammoth from "mammoth";
import { extractText } from "unpdf";
import { DOCUMENTS } from "../../config/constants.ts";
import { badRequest } from "../../utils/response.ts";

/** File types a brief document may have, by extension. */
export const BRIEF_EXTENSIONS = /\.(pdf|docx|txt|md)$/i;

export interface ExtractedText {
  text: string;
  /** True when the document was longer than DOCUMENTS.maxChars and was cut. */
  truncated: boolean;
}

/** Collapses runs of spaces and blank lines, which PDFs are full of, so the cap keeps more real text. */
export function tidyText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The raw text of one file; throws 400 FILE_UNREADABLE when the parser fails. */
async function rawText(filename: string, buffer: Buffer): Promise<string> {
  try {
    if (/\.pdf$/i.test(filename)) return (await extractText(new Uint8Array(buffer), { mergePages: true })).text;
    if (/\.docx$/i.test(filename)) return (await mammoth.extractRawText({ buffer })).value;
    return buffer.toString("utf8");
  } catch {
    throw badRequest("FILE_UNREADABLE", `Could not read ${filename}. Save it again as PDF, .docx or .txt and upload it.`);
  }
}

/**
 * The text of a brief document. Throws 400 FILE_TYPE_NOT_ALLOWED for other types (an old .doc included),
 * and 400 FILE_UNREADABLE when it cannot be read or holds no text (a scanned PDF has none).
 */
export async function extractDocumentText(filename: string, buffer: Buffer): Promise<ExtractedText> {
  if (!BRIEF_EXTENSIONS.test(filename)) {
    throw badRequest("FILE_TYPE_NOT_ALLOWED", "Upload the job description or order as PDF, Word (.docx) or text (.txt)");
  }
  const text = tidyText(await rawText(filename, buffer));
  if (!text) throw badRequest("FILE_UNREADABLE", `${filename} has no readable text. A scanned PDF needs a text layer (OCR) first.`);
  return { text: text.slice(0, DOCUMENTS.maxChars), truncated: text.length > DOCUMENTS.maxChars };
}
