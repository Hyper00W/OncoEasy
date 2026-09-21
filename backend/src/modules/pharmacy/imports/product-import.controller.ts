import type { RequestHandler } from "express";

import { AppError } from "../../../errors/app-error";
import {
  getProductImportJob,
  listProductImportJobs,
  persistProductImport
} from "./product-import.persistence.service";
import type { ProductImportListQuery } from "./product-import.schemas";

export const importProducts: RequestHandler = async (request, response, next) => {
  try {
    if (!request.file) {
      throw new AppError(400, "FILE_REQUIRED", "An XLSX file is required");
    }
    response.status(201).json({
      success: true,
      data: await persistProductImport(request.user?.userId as string, {
        buffer: request.file.buffer,
        fileName: request.file.originalname,
        mimeType: request.file.mimetype
      })
    });
  } catch (error) {
    next(error);
  }
};

export const listImports: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await listProductImportJobs(request.query as unknown as ProductImportListQuery)
    });
  } catch (error) {
    next(error);
  }
};

export const getImport: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await getProductImportJob(request.params.importJobId as string)
    });
  } catch (error) {
    next(error);
  }
};