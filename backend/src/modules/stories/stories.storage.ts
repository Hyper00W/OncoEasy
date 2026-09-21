import path from "node:path";

import { AppError } from "../../errors/app-error";

export const allowedStoryPhotoTypes = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
} as const;

export function validateStoryPhoto(file: Express.Multer.File) {
  const extension = path.extname(file.originalname).toLowerCase();
  const expected = allowedStoryPhotoTypes[file.mimetype as keyof typeof allowedStoryPhotoTypes];
  if (!expected || expected !== extension || !hasSignature(file.buffer, file.mimetype)) {
    throw new AppError(400, "UNSUPPORTED_FILE_TYPE", "Story photos must be JPEG, PNG, or WEBP with a matching file type");
  }
  return { extension, mimeType: file.mimetype };
}

function hasSignature(buffer: Buffer, mimeType: string) {
  if (mimeType === "image/jpeg") return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
}

export function normalizeStoryPhotoName(name: string) {
  const base = path.basename(name).replace(/[\u0000-\u001f\u007f]/g, "");
  return (base.trim().replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 255) || "story-photo");
}
