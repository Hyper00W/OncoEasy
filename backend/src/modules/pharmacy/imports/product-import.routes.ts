import { UserRole } from "@prisma/client";
import multer from "multer";
import { Router } from "express";

import { AppError } from "../../../errors/app-error";
import { authenticate } from "../../../middleware/authenticate";
import { requireRole } from "../../../middleware/require-role";
import { validateRequest } from "../../../middleware/validate-request";
import { importProducts, getImport, listImports } from "./product-import.controller";
import { productImportListQuerySchema, productImportParamsSchema } from "./product-import.schemas";
import { PRODUCT_IMPORT_MAX_FILE_SIZE_BYTES } from "./product-import.service";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PRODUCT_IMPORT_MAX_FILE_SIZE_BYTES },
  fileFilter: (_request, file, callback) => {
    if (file.originalname.toLowerCase().endsWith(".xlsx")) {
      callback(null, true);
      return;
    }
    callback(new AppError(400, "IMPORT_FILE_INVALID", "Only .xlsx files are supported"));
  }
});

function parseUpload(
  request: Parameters<typeof importProducts>[0],
  response: Parameters<typeof importProducts>[1],
  next: Parameters<typeof importProducts>[2]
) {
  upload.single("file")(request, response, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(new AppError(413, "FILE_TOO_LARGE", "The XLSX file exceeds the 10 MB limit"));
      return;
    }
    next(error);
  });
}

export const productImportRouter = Router();
productImportRouter.use(authenticate, requireRole(UserRole.PHARMACIST, UserRole.OPS_ADMIN, UserRole.OWNER));
productImportRouter.post("/", parseUpload, importProducts);
productImportRouter.get(
  "/",
  validateRequest({ query: productImportListQuerySchema }),
  listImports
);
productImportRouter.get(
  "/:importJobId",
  validateRequest({ params: productImportParamsSchema }),
  getImport
);