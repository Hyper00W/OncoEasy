type ImportJobRecord = {
  id: string;
  status: string;
  fileName: string | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createdProducts: number;
  updatedProducts: number;
  failedRows: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  rows?: Array<{
    id: string;
    rowNumber: number;
    sku: string | null;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
    action: string | null;
  }>;
};

export function toProductImportJobResponse(job: ImportJobRecord, includeRows = false) {
  return {
    importJobId: job.id,
    status: job.status,
    fileName: job.fileName,
    totalRows: job.totalRows,
    validRows: job.validRows,
    invalidRows: job.invalidRows,
    createdProducts: job.createdProducts,
    updatedProducts: job.updatedProducts,
    failedRows: job.failedRows,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    ...(includeRows
      ? {
          rows: (job.rows ?? []).map((row) => ({
            id: row.id,
            rowNumber: row.rowNumber,
            sku: row.sku,
            status: row.status,
            errorCode: row.errorCode,
            errorMessage: row.errorMessage,
            action: row.action
          }))
        }
      : {})
  };
}