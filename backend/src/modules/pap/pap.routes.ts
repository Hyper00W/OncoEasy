import { UserRole } from "@prisma/client";
import multer from "multer";
import { Router } from "express";

import { env } from "../../config/env";
import { AppError } from "../../errors/app-error";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/require-role";
import { validateRequest } from "../../middleware/validate-request";
import {
  createApplication,
  getAdmin,
  getDocument,
  getApplication,
  getProgram,
  listAdmin,
  listApplications,
  listPrograms,
  updateStatus,
  uploadDocument
} from "./pap.controller";
import {
  createPapApplicationSchema,
  papApplicationListQuerySchema,
  papApplicationParamsSchema,
  papDocumentParamsSchema,
  papProgramParamsSchema,
  updatePapStatusSchema
} from "./pap.schemas";
import { allowedPapDocumentTypes } from "./pap.storage";

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.PRESCRIPTION_MAX_FILE_SIZE_BYTES },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype in allowedPapDocumentTypes) {
      callback(null, true);
      return;
    }
    callback(new AppError(400, "UNSUPPORTED_FILE_TYPE", "PAP document type is not supported"));
  }
});

function parseDocumentUpload(request: Parameters<typeof uploadDocument>[0], response: Parameters<typeof uploadDocument>[1], next: Parameters<typeof uploadDocument>[2]) {
  documentUpload.single("file")(request, response, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(new AppError(413, "FILE_TOO_LARGE", "PAP document is too large"));
      return;
    }
    if (error instanceof multer.MulterError && error.code === "LIMIT_UNEXPECTED_FILE") {
      next(new AppError(400, "INVALID_REQUEST", "Only one file field named file is allowed"));
      return;
    }
    next(error);
  });
}

export const papRouter = Router();
papRouter.use(authenticate, requireRole(UserRole.PATIENT));
papRouter.get("/programs", listPrograms);
papRouter.get("/programs/:programId", validateRequest({ params: papProgramParamsSchema }), getProgram);
papRouter.post("/applications", validateRequest({ body: createPapApplicationSchema }), createApplication);
papRouter.get("/applications", listApplications);
papRouter.get("/applications/:applicationId", validateRequest({ params: papApplicationParamsSchema }), getApplication);
papRouter.post("/applications/:applicationId/documents", validateRequest({ params: papApplicationParamsSchema }), parseDocumentUpload, uploadDocument);

export const adminPapRouter = Router();
adminPapRouter.use(authenticate, requireRole(UserRole.OPS_ADMIN));
adminPapRouter.get("/applications", validateRequest({ query: papApplicationListQuerySchema }), listAdmin);
adminPapRouter.get("/applications/:applicationId", validateRequest({ params: papApplicationParamsSchema }), getAdmin);
adminPapRouter.patch("/applications/:applicationId/status", validateRequest({ params: papApplicationParamsSchema, body: updatePapStatusSchema }), updateStatus);
adminPapRouter.get("/applications/:applicationId/documents/:documentId", validateRequest({ params: papDocumentParamsSchema }), getDocument);
