import { UserRole } from "@prisma/client";
import multer from "multer";
import { Router } from "express";

import { env } from "../../config/env";
import { AppError } from "../../errors/app-error";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/require-role";
import { validateRequest } from "../../middleware/validate-request";
import { create, getAdmin, getAdminMedia, getPublicMedia, listAdmin, listPublished, remove, update, uploadMedia } from "./testimonials.controller";
import { createTestimonialSchema, testimonialIdParamsSchema, testimonialListQuerySchema, testimonialMediaQuerySchema, updateTestimonialSchema } from "./testimonials.schemas";
import { allowedTestimonialMediaTypes } from "./testimonials.storage";

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.DELIVERY_PROOF_MAX_FILE_SIZE_BYTES },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype in allowedTestimonialMediaTypes) callback(null, true);
    else callback(new AppError(400, "UNSUPPORTED_FILE_TYPE", "Testimonial media type is not supported"));
  }
});

function parseMedia(request: Parameters<typeof uploadMedia>[0], response: Parameters<typeof uploadMedia>[1], next: Parameters<typeof uploadMedia>[2]) {
  mediaUpload.single("file")(request, response, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(new AppError(413, "FILE_TOO_LARGE", "Testimonial media file is too large"));
      return;
    }
    next(error);
  });
}

/** Public/patient read endpoint: only published testimonials, no auth. */
export const testimonialsRouter = Router();
testimonialsRouter.get("/", validateRequest({ query: testimonialListQuerySchema }), listPublished);
// Published-only media delivery for the public testimonials page.
testimonialsRouter.get("/:testimonialId/media", validateRequest({ params: testimonialIdParamsSchema }), getPublicMedia);

export const adminTestimonialsRouter = Router();
adminTestimonialsRouter.use(authenticate, requireRole(UserRole.OPS_ADMIN, UserRole.OWNER));
adminTestimonialsRouter.get("/", validateRequest({ query: testimonialListQuerySchema }), listAdmin);
adminTestimonialsRouter.get("/:testimonialId", validateRequest({ params: testimonialIdParamsSchema }), getAdmin);
adminTestimonialsRouter.post("/", validateRequest({ body: createTestimonialSchema }), create);
adminTestimonialsRouter.patch("/:testimonialId", validateRequest({ params: testimonialIdParamsSchema, body: updateTestimonialSchema }), update);
adminTestimonialsRouter.delete("/:testimonialId", validateRequest({ params: testimonialIdParamsSchema }), remove);
adminTestimonialsRouter.post("/:testimonialId/media", validateRequest({ params: testimonialIdParamsSchema, query: testimonialMediaQuerySchema }), parseMedia, uploadMedia);
// Admin preview: works for unpublished testimonials, still requires OPS_ADMIN.
adminTestimonialsRouter.get("/:testimonialId/media", validateRequest({ params: testimonialIdParamsSchema }), getAdminMedia);
