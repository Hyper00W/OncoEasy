import { Prisma, ProductImportJobStatus, ProductImportRowAction, ProductImportRowStatus } from "@prisma/client";

import { prisma } from "../../../database/prisma";
import { AppError } from "../../../errors/app-error";
import {
  ProductImportFileError,
  type NormalizedProductImportRow,
  type ProductImportFile,
  validateProductImportFile
} from "./product-import.service";
import type { ProductImportListQuery } from "./product-import.schemas";
import { toProductImportJobResponse } from "./product-import.mapper";

const jobInclude = {
  rows: { orderBy: { rowNumber: "asc" as const } }
} as const;

export async function persistProductImport(
  createdByUserId: string,
  file: ProductImportFile
) {
  const categories = await prisma.productCategory.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true }
  });
  let validation;
  try {
    validation = validateProductImportFile(file, categories);
    if (validation.errorsByRow[1]) {
      throw new AppError(400, "IMPORT_FILE_INVALID", "The XLSX header row is invalid");
    }
  } catch (error) {
    if (error instanceof ProductImportFileError) {
      throw new AppError(400, "IMPORT_FILE_INVALID", error.message);
    }
    throw error;
  }

  const invalidRows = Object.entries(validation.errorsByRow).map(([rowNumber, errors]) => ({
    rowNumber: Number(rowNumber),
    sku: null,
    status: ProductImportRowStatus.INVALID,
    errorCode: errors[0]?.field ? errors[0].field.toUpperCase() : "ROW_VALIDATION_ERROR",
    errorMessage: errors.map((error) => error.message).join("; "),
    action: ProductImportRowAction.SKIPPED
  }));
  const validRowNumbers = new Set(validation.normalizedValidRows.map((row) => row.sourceRowNumber));
  const rows = [
    ...invalidRows,
    ...validation.normalizedValidRows.map((row) => ({
      rowNumber: row.sourceRowNumber,
      sku: row.sku.trim(),
      status: ProductImportRowStatus.VALID,
      errorCode: null,
      errorMessage: null,
      action: null
    }))
  ].filter((row) => !validRowNumbers.has(row.rowNumber) || row.status === ProductImportRowStatus.VALID);

  const job = await prisma.productImportJob.create({
    data: {
      createdByUserId,
      status: ProductImportJobStatus.PROCESSING,
      fileName: file.fileName,
      totalRows: validation.totalRows,
      validRows: validation.validRows,
      invalidRows: validation.invalidRows,
      startedAt: new Date(),
      rows: { create: rows }
    },
    include: jobInclude
  });

  let createdProducts = 0;
  let updatedProducts = 0;
  let failedRows = 0;
  const processingErrors: Array<{ rowNumber: number; sku: string; message: string }> = [];

  for (const row of validation.normalizedValidRows) {
    try {
      const action = await processValidRow(job.id, row);
      if (action === ProductImportRowAction.CREATE) createdProducts += 1;
      if (action === ProductImportRowAction.UPDATE) updatedProducts += 1;
    } catch (error) {
      failedRows += 1;
      const message = error instanceof Error ? error.message : "Product row could not be persisted";
      processingErrors.push({ rowNumber: row.sourceRowNumber, sku: row.sku, message });
      await prisma.productImportRow.update({
        where: { jobId_rowNumber: { jobId: job.id, rowNumber: row.sourceRowNumber } },
        data: {
          status: ProductImportRowStatus.FAILED,
          action: ProductImportRowAction.SKIPPED,
          errorCode: "PERSISTENCE_ERROR",
          errorMessage: "Product row could not be persisted"
        }
      });
    }
  }

  const finalStatus = validation.invalidRows > 0 || failedRows > 0
    ? ProductImportJobStatus.COMPLETED_WITH_ERRORS
    : ProductImportJobStatus.COMPLETED;
  const completed = await prisma.productImportJob.update({
    where: { id: job.id },
    data: { status: finalStatus, createdProducts, updatedProducts, failedRows, completedAt: new Date() },
    include: jobInclude
  });

  return {
    ...toProductImportJobResponse(completed, true),
    errors: [
      ...Object.entries(validation.errorsByRow).flatMap(([rowNumber, errors]) =>
        errors.map((error) => ({ rowNumber: Number(rowNumber), field: error.field, message: error.message }))
      ),
      ...processingErrors
    ]
  };
}

async function processValidRow(jobId: string, row: NormalizedProductImportRow) {
  return prisma.$transaction(async (transaction) => {
    const sku = row.sku.trim();
    const existing = await transaction.product.findFirst({
      where: { sku: { equals: sku, mode: "insensitive" } },
      select: { id: true }
    });
    const data = {
      name: row.name,
      description: row.description ?? null,
      categoryId: row.categoryId,
      unitLabel: row.unitLabel ?? null,
      price: row.price,
      currency: row.currency,
      isActive: row.isActive,
      prescriptionRequired: row.prescriptionRequired,
      coldChainRequired: row.coldChainRequired,
      temperatureMinC: row.temperatureMinC ?? null,
      temperatureMaxC: row.temperatureMaxC ?? null,
      minimumQuantity: row.minimumQuantity,
      regularDeliveryEligible: row.regularDeliveryEligible,
      coldChainDeliveryEligible: row.coldChainDeliveryEligible
    };
    const action = existing
      ? ProductImportRowAction.UPDATE
      : ProductImportRowAction.CREATE;
    if (existing) {
      await transaction.product.update({ where: { id: existing.id }, data });
    } else {
      await transaction.product.create({ data: { ...data, sku } });
    }
    await transaction.productImportRow.update({
      where: { jobId_rowNumber: { jobId, rowNumber: row.sourceRowNumber } },
      data: { status: ProductImportRowStatus.PROCESSED, action, sku }
    });
    return action;
  });
}

export async function listProductImportJobs(query: ProductImportListQuery) {
  const skip = (query.page - 1) * query.pageSize;
  const [total, jobs] = await prisma.$transaction([
    prisma.productImportJob.count(),
    prisma.productImportJob.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: query.pageSize })
  ]);
  return { items: jobs.map((job) => toProductImportJobResponse(job)), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
}

export async function getProductImportJob(importJobId: string) {
  const job = await prisma.productImportJob.findUnique({ where: { id: importJobId }, include: jobInclude });
  if (!job) throw new AppError(404, "IMPORT_JOB_NOT_FOUND", "Product import job was not found");
  return toProductImportJobResponse(job, true);
}