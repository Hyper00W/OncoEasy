import * as XLSX from "xlsx";

import {
  productCatalogInputSchema,
  type ProductCatalogInput
} from "../catalog/product-validation";

export const PRODUCT_IMPORT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const PRODUCT_IMPORT_COLUMNS = [
  "sku",
  "name",
  "description",
  "category",
  "price",
  "currency",
  "unitLabel",
  "prescriptionRequired",
  "coldChainRequired",
  "temperatureMinC",
  "temperatureMaxC",
  "minimumQuantity",
  "regularDeliveryEligible",
  "coldChainDeliveryEligible",
  "isActive"
] as const;

const supportedMimeTypes = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
  ""
]);

const columnByNormalizedHeader = new Map(
  PRODUCT_IMPORT_COLUMNS.map((column) => [normalizeHeader(column), column])
);

type ProductImportColumn = (typeof PRODUCT_IMPORT_COLUMNS)[number];

export type ProductImportCategory = {
  id: string;
  name: string;
  slug: string;
};

export type ProductImportFile = {
  buffer: Buffer;
  fileName: string;
  mimeType?: string;
};

export type ProductImportError = {
  rowNumber: number;
  field?: string;
  message: string;
};

export type NormalizedProductImportRow = ProductCatalogInput & {
  sourceRowNumber: number;
};

export type ProductImportValidationResult = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errorsByRow: Record<number, ProductImportError[]>;
  normalizedValidRows: NormalizedProductImportRow[];
};

export function validateProductImportFile(
  file: ProductImportFile,
  categories: ProductImportCategory[]
): ProductImportValidationResult {
  validateFileMetadata(file);

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(file.buffer, { type: "buffer", cellDates: false });
  } catch {
    throw new ProductImportFileError("The XLSX file could not be parsed");
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new ProductImportFileError("The XLSX file does not contain a worksheet");
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: "",
    raw: true,
    blankrows: false
  });

  if (rows.length === 0) {
    throw new ProductImportFileError("The first worksheet is empty");
  }

  const headerResult = normalizeHeaders(rows[0]);
  if (headerResult.errors.length > 0) {
    return {
      totalRows: Math.max(rows.length - 1, 0),
      validRows: 0,
      invalidRows: Math.max(rows.length - 1, 0),
      errorsByRow: { 1: headerResult.errors },
      normalizedValidRows: []
    };
  }

  const errorsByRow: Record<number, ProductImportError[]> = {};
  const normalizedRows: Array<{
    rowNumber: number;
    sku: string;
    product: ProductCatalogInput | null;
  }> = [];

  for (let index = 1; index < rows.length; index += 1) {
    const rowNumber = index + 1;
    const rawRow = rows[index] ?? [];
    const rawRecord = toRawRecord(headerResult.headers, rawRow);
    const category = resolveCategory(rawRecord.category, categories);
    const rowErrors: ProductImportError[] = [];

    if (!category) {
      rowErrors.push({
        rowNumber,
        field: "category",
        message: "Category does not match an existing name or slug"
      });
    }

    const normalizedInput = normalizeProductRow(rawRecord, category?.id);
    const parsed = productCatalogInputSchema.safeParse(normalizedInput);

    if (!parsed.success) {
      rowErrors.push(
        ...parsed.error.issues.map((issue) => ({
          rowNumber,
          field: issue.path.join(".") || undefined,
          message: issue.message
        }))
      );
    }

    if (rowErrors.length > 0) {
      errorsByRow[rowNumber] = rowErrors;
    }

    normalizedRows.push({
      rowNumber,
      sku: normalizeText(rawRecord.sku),
      product: parsed.success && category ? parsed.data : null
    });
  }

  addDuplicateSkuErrors(normalizedRows, errorsByRow);

  const normalizedValidRows = normalizedRows
    .filter(({ rowNumber, product }) => product && !errorsByRow[rowNumber])
    .map(({ rowNumber, product }) => ({
      ...product!,
      sourceRowNumber: rowNumber
    }));

  return {
    totalRows: rows.length - 1,
    validRows: normalizedValidRows.length,
    invalidRows: rows.length - 1 - normalizedValidRows.length,
    errorsByRow,
    normalizedValidRows
  };
}

export class ProductImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductImportFileError";
  }
}

function validateFileMetadata(file: ProductImportFile): void {
  if (!file.fileName.toLowerCase().endsWith(".xlsx")) {
    throw new ProductImportFileError("Only .xlsx files are supported");
  }

  if (file.buffer.length === 0) {
    throw new ProductImportFileError("The XLSX file is empty");
  }

  if (file.buffer.length > PRODUCT_IMPORT_MAX_FILE_SIZE_BYTES) {
    throw new ProductImportFileError("The XLSX file exceeds the 10 MB limit");
  }

  if (file.mimeType && !supportedMimeTypes.has(file.mimeType.toLowerCase())) {
    throw new ProductImportFileError("The uploaded file type is not supported");
  }
}

function normalizeHeaders(values: unknown[]): {
  headers: ProductImportColumn[];
  errors: ProductImportError[];
} {
  const headers: ProductImportColumn[] = [];
  const errors: ProductImportError[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeHeader(value);
    if (!normalized) {
      headers.push("sku");
      continue;
    }

    const canonicalHeader = columnByNormalizedHeader.get(normalized);
    if (!canonicalHeader) {
      errors.push({ rowNumber: 1, message: `Unknown column: ${String(value)}` });
      headers.push("sku");
      continue;
    }

    if (seen.has(canonicalHeader)) {
      errors.push({ rowNumber: 1, field: canonicalHeader, message: "Duplicate column" });
    }

    seen.add(canonicalHeader);
    headers.push(canonicalHeader);
  }

  for (const requiredColumn of PRODUCT_IMPORT_COLUMNS) {
    if (!seen.has(requiredColumn)) {
      errors.push({
        rowNumber: 1,
        field: requiredColumn,
        message: "Required column is missing"
      });
    }
  }

  return { headers, errors };
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/[\s_-]+/g, "")
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function toRawRecord(
  headers: ProductImportColumn[],
  values: unknown[]
): Record<ProductImportColumn, unknown> {
  const record = {} as Record<ProductImportColumn, unknown>;

  for (let index = 0; index < headers.length; index += 1) {
    record[headers[index]] = values[index] ?? "";
  }

  return record;
}

function normalizeProductRow(
  raw: Record<ProductImportColumn, unknown>,
  categoryId: string | undefined
): Record<string, unknown> {
  return {
    sku: normalizeText(raw.sku),
    name: normalizeText(raw.name),
    description: normalizeNullableText(raw.description),
    categoryId,
    unitLabel: normalizeNullableText(raw.unitLabel),
    price: normalizeNumber(raw.price),
    currency: normalizeText(raw.currency).toUpperCase(),
    isActive: normalizeBoolean(raw.isActive),
    prescriptionRequired: normalizeBoolean(raw.prescriptionRequired),
    coldChainRequired: normalizeBoolean(raw.coldChainRequired),
    temperatureMinC: normalizeNullableNumber(raw.temperatureMinC),
    temperatureMaxC: normalizeNullableNumber(raw.temperatureMaxC),
    minimumQuantity: normalizeNumber(raw.minimumQuantity),
    regularDeliveryEligible: normalizeBoolean(raw.regularDeliveryEligible),
    coldChainDeliveryEligible: normalizeBoolean(raw.coldChainDeliveryEligible)
  };
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeNullableText(value: unknown): string | null {
  const text = normalizeText(value);
  return text === "" ? null : text;
}

function normalizeNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  const text = normalizeText(value).replace(/,/g, "");
  return text === "" ? Number.NaN : Number(text);
}

function normalizeNullableNumber(value: unknown): number | null {
  const text = normalizeText(value);
  return text === "" ? null : normalizeNumber(text);
}

function normalizeBoolean(value: unknown): boolean | string {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = normalizeText(value).toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) {
    return true;
  }

  if (["false", "no", "0"].includes(normalized)) {
    return false;
  }

  return normalized;
}

function resolveCategory(
  value: unknown,
  categories: ProductImportCategory[]
): ProductImportCategory | undefined {
  const normalized = normalizeText(value).toLowerCase();
  return categories.find(
    (category) =>
      category.slug.trim().toLowerCase() === normalized ||
      category.name.trim().toLowerCase() === normalized
  );
}

function addDuplicateSkuErrors(
  rows: Array<{ rowNumber: number; sku: string; product: ProductCatalogInput | null }>,
  errorsByRow: Record<number, ProductImportError[]>
): void {
  const rowsBySku = new Map<string, number[]>();

  for (const row of rows) {
    const normalizedSku = row.sku.toLowerCase();
    if (!normalizedSku) {
      continue;
    }

    const matchingRows = rowsBySku.get(normalizedSku) ?? [];
    matchingRows.push(row.rowNumber);
    rowsBySku.set(normalizedSku, matchingRows);
  }

  for (const matchingRows of rowsBySku.values()) {
    if (matchingRows.length < 2) {
      continue;
    }

    for (const rowNumber of matchingRows) {
      const errors = errorsByRow[rowNumber] ?? [];
      errors.push({
        rowNumber,
        field: "sku",
        message: "SKU is duplicated within the uploaded file"
      });
      errorsByRow[rowNumber] = errors;
    }
  }
}
