import path from "node:path";

import { AppError } from "../../../errors/app-error";

export const allowedPrescriptionTypes = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
} as const;

export function validatePrescriptionFile(file: Express.Multer.File) {
  const extension = path.extname(file.originalname).toLowerCase();
  const expectedExtension = allowedPrescriptionTypes[file.mimetype as keyof typeof allowedPrescriptionTypes];

  if (
    !expectedExtension ||
    extension !== expectedExtension ||
    !hasExpectedFileSignature(file.buffer, file.mimetype)
  ) {
    throw new AppError(
      400,
      "UNSUPPORTED_FILE_TYPE",
      "Prescription files must be PDF, JPEG, PNG, or WEBP with a matching file type"
    );
  }

  return { extension, mimeType: file.mimetype };
}

function hasExpectedFileSignature(buffer: Buffer, mimeType: string) {
  if (mimeType === "application/pdf") {
    return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  }

  if (mimeType === "image/jpeg") {
    return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  }

  if (mimeType === "image/png") {
    return buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  }

  return (
    mimeType === "image/webp" &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

export function normalizeDocumentName(originalName: string) {
  const baseName = path.basename(originalName).replace(/[\u0000-\u001f\u007f]/g, "");
  const normalized = baseName.trim().replace(/[^a-zA-Z0-9._ -]/g, "_");
  return normalized.slice(0, 255) || "prescription";
}