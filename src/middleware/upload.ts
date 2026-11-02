import multer from "multer";
import { LIMITS } from "../config/constants.js";

const BYTES_PER_MB = 1024 * 1024;

/** Multipart uploads held in memory, one file, capped by MAX_UPLOAD_MB (413 PAYLOAD_TOO_LARGE above it). */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.maxUploadMb * BYTES_PER_MB, files: 1 },
});
