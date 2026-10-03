import { UserRole } from "@prisma/client";
import multer from "multer";
import { Router } from "express";

import { env } from "../../../config/env";
import { AppError } from "../../../errors/app-error";
import { authenticate } from "../../../middleware/authenticate";
import { requireRole } from "../../../middleware/require-role";
import { validateRequest } from "../../../middleware/validate-request";
import {
  getPrescription,
  getReviewPrescription,
  listPrescriptions,
  listReviewQueue,
  queryReviewPrescription,
  rejectReviewPrescription,
  uploadPrescription,
  verifyReviewPrescription
} from "./prescription.controller";
import {
  prescriptionListQuerySchema,
  prescriptionParamsSchema,
  prescriptionReviewReasonSchema,
  prescriptionUploadBodySchema
} from "./prescription.schemas";
import { allowedPrescriptionTypes } from "./prescription.storage";

const multipartUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.PRESCRIPTION_MAX_FILE_SIZE_BYTES },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype in allowedPrescriptionTypes) {
      callback(null, true);
      return;
    }

    callback(new AppError(400, "UNSUPPORTED_FILE_TYPE", "Prescription file type is not supported"));
  }
});

function parseMultipartUpload(request: Parameters<typeof uploadPrescription>[0], response: Parameters<typeof uploadPrescription>[1], next: Parameters<typeof uploadPrescription>[2]) {
  multipartUpload.single("file")(request, response, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(new AppError(413, "FILE_TOO_LARGE", "Prescription file is too large"));
      return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_UNEXPECTED_FILE") {
      next(new AppError(400, "INVALID_REQUEST", "Only one file field named file is allowed"));
      return;
    }

    next(error);
  });
}

export const prescriptionRouter = Router();

prescriptionRouter.post(
  "/",
  authenticate,
  requireRole(UserRole.PATIENT),
  parseMultipartUpload,
  validateRequest({ body: prescriptionUploadBodySchema }),
  uploadPrescription
);
prescriptionRouter.get(
  "/",
  authenticate,
  requireRole(UserRole.PATIENT),
  validateRequest({ query: prescriptionListQuerySchema }),
  listPrescriptions
);
prescriptionRouter.get(
  "/review-queue",
  authenticate,
  requireRole(UserRole.PHARMACIST, UserRole.OPS_ADMIN, UserRole.OWNER),
  validateRequest({ query: prescriptionListQuerySchema }),
  listReviewQueue
);
prescriptionRouter.get(
  "/review/:prescriptionId",
  authenticate,
  requireRole(UserRole.PHARMACIST, UserRole.OPS_ADMIN, UserRole.OWNER),
  validateRequest({ params: prescriptionParamsSchema }),
  getReviewPrescription
);
prescriptionRouter.get(
  "/:prescriptionId",
  authenticate,
  requireRole(UserRole.PATIENT),
  validateRequest({ params: prescriptionParamsSchema }),
  getPrescription
);
prescriptionRouter.patch(
  "/:prescriptionId/verify",
  authenticate,
  requireRole(UserRole.PHARMACIST, UserRole.OPS_ADMIN, UserRole.OWNER),
  validateRequest({ params: prescriptionParamsSchema }),
  verifyReviewPrescription
);
prescriptionRouter.patch(
  "/:prescriptionId/reject",
  authenticate,
  requireRole(UserRole.PHARMACIST, UserRole.OPS_ADMIN, UserRole.OWNER),
  validateRequest({ params: prescriptionParamsSchema, body: prescriptionReviewReasonSchema }),
  rejectReviewPrescription
);
prescriptionRouter.patch(
  "/:prescriptionId/query",
  authenticate,
  requireRole(UserRole.PHARMACIST, UserRole.OPS_ADMIN, UserRole.OWNER),
  validateRequest({ params: prescriptionParamsSchema, body: prescriptionReviewReasonSchema }),
  queryReviewPrescription
);