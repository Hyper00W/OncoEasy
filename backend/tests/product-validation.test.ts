import assert from "node:assert/strict";
import { test } from "node:test";

import { productCatalogInputSchema } from "../src/modules/pharmacy/catalog/product-validation";

const validProduct = {
  sku: "ONCO-001",
  name: "Sample product",
  categoryId: "550e8400-e29b-41d4-a716-446655440000",
  price: 125.5,
  currency: "INR",
  coldChainRequired: true,
  temperatureMinC: 2,
  temperatureMaxC: 8,
  minimumQuantity: 1
};

test("accepts a valid catalog product", () => {
  const result = productCatalogInputSchema.safeParse(validProduct);

  assert.equal(result.success, true);
});

test("rejects a negative price and invalid minimum quantity", () => {
  const result = productCatalogInputSchema.safeParse({
    ...validProduct,
    price: -1,
    minimumQuantity: 0
  });

  assert.equal(result.success, false);
});

test("requires both temperature bounds together", () => {
  const result = productCatalogInputSchema.safeParse({
    ...validProduct,
    temperatureMaxC: null
  });

  assert.equal(result.success, false);
});

test("rejects reversed temperature bounds", () => {
  const result = productCatalogInputSchema.safeParse({
    ...validProduct,
    temperatureMinC: 8,
    temperatureMaxC: 2
  });

  assert.equal(result.success, false);
});

test("rejects temperature values for non-cold-chain products", () => {
  const result = productCatalogInputSchema.safeParse({
    ...validProduct,
    coldChainRequired: false
  });

  assert.equal(result.success, false);
});

test("rejects an empty product name", () => {
  const result = productCatalogInputSchema.safeParse({
    ...validProduct,
    name: "   "
  });

  assert.equal(result.success, false);
});
