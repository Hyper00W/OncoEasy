import path from "node:path";

import { AppError } from "../../errors/app-error";

export const allowedTestimonialImageTypes = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
} as const;

export const allowedTestimonialVideoTypes = {
  "video/mp4": ".mp4",
  "video/webm": ".webm"
} as const;

export const allowedTestimonialMediaTypes = {
  ...allowedTestimonialImageTypes,
  ...allowedTestimonialVideoTypes
} as const;

export type TestimonialMediaType = keyof typeof allowedTestimonialMediaTypes;

export function validateTestimonialMedia(file: Express.Multer.File, type: "IMAGE" | "VIDEO") {
  const extension = path.extname(file.originalname).toLowerCase();
  const expected = allowedTestimonialMediaTypes[file.mimetype as TestimonialMediaType];
  if (
    !expected ||
    expected !== extension ||
    !hasSignature(file.buffer, file.mimetype) ||
    (type === "IMAGE" && !(file.mimetype in allowedTestimonialImageTypes)) ||
    (type === "VIDEO" && !(file.mimetype in allowedTestimonialVideoTypes))
  ) {
    throw new AppError(
      400,
      "UNSUPPORTED_FILE_TYPE",
      type === "IMAGE"
        ? "Testimonial images must be JPEG, PNG, or WEBP with a matching file type"
        : "Testimonial videos must be MP4 or WEBM with a matching file type"
    );
  }

  return { extension, mimeType: file.mimetype };
}

function hasSignature(buffer: Buffer, mimeType: string) {
  if (mimeType === "image/jpeg") return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/webp") {
    return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  // MP4: the major-brand box at offset 4 must read "ftyp".
  if (mimeType === "video/mp4") return buffer.subarray(4, 8).toString("ascii") === "ftyp";
  // WEBM: the EBML container header 0x1A45DFA3.
  if (mimeType === "video/webm") return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

export function normalizeTestimonialMediaName(name: string) {
  const base = path.basename(name).replace(/[\u0000-\u001f\u007f]/g, "");
  return (base.trim().replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 255) || "testimonial-media");
}
