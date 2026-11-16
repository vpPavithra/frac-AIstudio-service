// UPLOAD EXPANSION GUARD (security review, 16 Nov 2026). A .docx or .xlsx file is a zip: a small upload can unpack to
// gigabytes inside mammoth or exceljs and take the service down. Before either parser runs, this reads the zip's
// central directory (no decompression) and refuses a file whose entries add up to more than DOCUMENTS.maxUnzippedMb or
// that has more than DOCUMENTS.maxZipEntries entries. Used by extract-text.ts (brief .docx), document.service.ts
// (standard sheets) and review.service.ts (Review FRAC uploads). A file that is not a zip is left to the parser, which
// reports it as unreadable.
import { DOCUMENTS } from "../../config/constants.ts";
import { ApiError } from "../../utils/response.ts";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
/** End-of-central-directory record: 22 bytes, plus a comment of up to 65,535. */
const EOCD_MIN = 22;
const EOCD_SEARCH = EOCD_MIN + 0xffff;
/** ZIP64 markers: the real values live in a ZIP64 record, which Office files never need. */
const ZIP64_16 = 0xffff;
const ZIP64_32 = 0xffffffff;

export interface ZipSummary {
  entries: number;
  uncompressedBytes: number;
}

const tooComplex = (name: string, why: string) =>
  new ApiError(400, "FILE_TOO_COMPLEX", `${name} ${why}. Save it again as a plain file (no embedded objects) and upload it.`);

/** The entry count and total unpacked size from the central directory, or null when the buffer is not a zip. */
export function summarizeZip(buffer: Buffer): ZipSummary | null {
  const from = Math.max(0, buffer.length - EOCD_SEARCH);
  let eocd = -1;
  for (let i = buffer.length - EOCD_MIN; i >= from; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = buffer.readUInt16LE(eocd + 10);
  const size = buffer.readUInt32LE(eocd + 12);
  const offset = buffer.readUInt32LE(eocd + 16);
  if (entries === ZIP64_16 || size === ZIP64_32 || offset === ZIP64_32) return { entries: Infinity, uncompressedBytes: Infinity };
  if (offset + size > buffer.length) return { entries: Infinity, uncompressedBytes: Infinity };

  let pos = offset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== CENTRAL_SIGNATURE) return { entries: Infinity, uncompressedBytes: Infinity };
    const uncompressed = buffer.readUInt32LE(pos + 24);
    if (uncompressed === ZIP64_32) return { entries: Infinity, uncompressedBytes: Infinity };
    total += uncompressed;
    pos += 46 + buffer.readUInt16LE(pos + 28) + buffer.readUInt16LE(pos + 30) + buffer.readUInt16LE(pos + 32);
  }
  return { entries, uncompressedBytes: total };
}

/**
 * Throws 400 FILE_TOO_COMPLEX when the zip would unpack past DOCUMENTS.maxUnzippedMb or holds more than
 * DOCUMENTS.maxZipEntries entries (a damaged directory counts as too complex). Returns quietly for a safe zip, or for a
 * file that is not a zip at all.
 */
export function assertZipSafe(buffer: Buffer, name: string): void {
  const summary = summarizeZip(buffer);
  if (!summary) return;
  if (summary.entries > DOCUMENTS.maxZipEntries) throw tooComplex(name, `has too many parts (more than ${DOCUMENTS.maxZipEntries})`);
  if (summary.uncompressedBytes > DOCUMENTS.maxUnzippedMb * 1024 * 1024) {
    throw tooComplex(name, `would unpack to more than ${DOCUMENTS.maxUnzippedMb} MB`);
  }
}

/** Resolves with `work`, or rejects with 400 FILE_TOO_COMPLEX when it takes longer than DOCUMENTS.parseTimeoutMs. */
export async function withParseTimeout<T>(work: Promise<T>, name: string, ms = DOCUMENTS.parseTimeoutMs): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(tooComplex(name, `took too long to read (over ${Math.round(ms / 1000)} seconds)`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
