import path from "node:path";

import { AppError } from "../../errors/app-error";

export const allowedLabReportTypes = { "application/pdf": ".pdf" } as const;

export function validateLabReportFile(file: Express.Multer.File) {
  const extension = path.extname(file.originalname).toLowerCase();
  if (file.mimetype !== "application/pdf" || extension !== ".pdf" || file.buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new AppError(400, "UNSUPPORTED_FILE_TYPE", "Lab reports must be PDF files with a valid PDF signature");
  }
  return { extension: ".pdf", mimeType: "application/pdf" };
}

export function normalizeLabReportName(originalName: string) {
  const baseName = path.basename(originalName).replace(/[\u0000-\u001f\u007f]/g, "");
  const normalized = baseName.trim().replace(/[^a-zA-Z0-9._ -]/g, "_");
  return normalized.slice(0, 255) || "lab-report.pdf";
}
