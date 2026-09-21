import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";

import {
  validateProductImportFile,
  type ProductImportCategory
} from "../src/modules/pharmacy/imports/product-import.service";

const categories: ProductImportCategory[] = [
  {
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "Cancer Care",
    slug: "cancer-care"
  }
];

const columns = [
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
];

const validRow = [
  "ONCO-001",
  "Cold product",
  "Description",
  "cancer-care",
  125.5,
  "inr",
  "box",
  "no",
  "yes",
  2,
  8,
  1,
  "true",
  "true",
  "1"
];

test("valid product row is normalized", () => {
  const result = importRows([validRow]);

  assert.equal(result.totalRows, 1);
  assert.equal(result.validRows, 1);
  assert.equal(result.invalidRows, 0);
  assert.deepEqual(result.normalizedValidRows[0], {
    sku: "ONCO-001",
    name: "Cold product",
    description: "Description",
    categoryId: categories[0].id,
    unitLabel: "box",
    price: 125.5,
    currency: "INR",
    isActive: true,
    prescriptionRequired: false,
    coldChainRequired: true,
    temperatureMinC: 2,
    temperatureMaxC: 8,
    minimumQuantity: 1,
    regularDeliveryEligible: true,
    coldChainDeliveryEligible: true,
    sourceRowNumber: 2
  });
});

test("missing required column is reported on the header row", () => {
  const result = importRows([validRow], columns.slice(0, -1));

  assert.equal(result.validRows, 0);
  assert.equal(result.errorsByRow[1].some((error) => error.field === "isActive"), true);
});

test("invalid price is reported with the Excel row number", () => {
  const result = importRows([[...validRow.slice(0, 4), "not-a-price", ...validRow.slice(5)]], columns);

  assert.equal(result.errorsByRow[2].some((error) => error.field === "price"), true);
});

test("invalid boolean is rejected", () => {
  const row = [...validRow];
  row[7] = "sometimes";
  const result = importRows([row]);

  assert.equal(result.errorsByRow[2].some((error) => error.field === "prescriptionRequired"), true);
});

test("invalid temperature combination is rejected", () => {
  const row = [...validRow];
  row[9] = 8;
  row[10] = 2;
  const result = importRows([row]);

  assert.equal(result.errorsByRow[2].some((error) => error.field === "temperatureMinC"), true);
});

test("invalid minimum quantity is rejected", () => {
  const row = [...validRow];
  row[11] = 0;
  const result = importRows([row]);

  assert.equal(result.errorsByRow[2].some((error) => error.field === "minimumQuantity"), true);
});

test("unknown category is rejected without creating a category", () => {
  const row = [...validRow];
  row[3] = "unknown-category";
  const result = importRows([row]);

  assert.equal(result.errorsByRow[2].some((error) => error.field === "category"), true);
});

test("duplicate SKUs are reported for every duplicate row", () => {
  const result = importRows([validRow, [...validRow]]);

  assert.equal(result.errorsByRow[2].some((error) => error.field === "sku"), true);
  assert.equal(result.errorsByRow[3].some((error) => error.field === "sku"), true);
  assert.equal(result.validRows, 0);
});

test("multiple row errors preserve their individual Excel row numbers", () => {
  const invalidFirstRow = [...validRow];
  invalidFirstRow[4] = -10;
  invalidFirstRow[7] = "unknown";
  const invalidSecondRow = [...validRow];
  invalidSecondRow[11] = 0;

  const result = importRows([invalidFirstRow, invalidSecondRow]);

  assert.equal(result.errorsByRow[2].every((error) => error.rowNumber === 2), true);
  assert.equal(result.errorsByRow[3].every((error) => error.rowNumber === 3), true);
  assert.equal(result.errorsByRow[2].length >= 2, true);
});

test("headers are normalized for case and whitespace", () => {
  const normalizedHeaders = columns.map((column) => ` ${column.toUpperCase()} `);
  const result = importRows([validRow], normalizedHeaders);

  assert.equal(result.validRows, 1);
});

function importRows(rows: unknown[][], headers = columns) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  return validateProductImportFile(
    {
      buffer,
      fileName: "products.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    },
    categories
  );
}
