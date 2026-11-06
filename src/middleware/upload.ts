// Multer instance for multipart uploads. Used only by POST /v1/frac-reviews (routes/review.routes.ts),
// which takes one .xlsx workbook as the `file` field. Size cap from LIMITS.maxUploadMb (MAX_UPLOAD_MB).
import multer from "multer";
import { LIMITS } from "../config/constants.ts";

const BYTES_PER_MB = 1024 * 1024;

/**
 * Multipart uploads held in memory, one file, capped by MAX_UPLOAD_MB (413 PAYLOAD_TOO_LARGE above it).
 * Memory, not disk: the workbook is parsed straight from the buffer and never stored as a file.
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.maxUploadMb * BYTES_PER_MB, files: 1 },
});
