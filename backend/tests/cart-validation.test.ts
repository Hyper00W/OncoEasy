import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";

import { calculateCartSummary } from "../src/modules/pharmacy/carts/cart.summary";
import { validateCartItems } from "../src/modules/pharmacy/carts/cart.validation";

test("calculates a Decimal-safe subtotal without floating-point loss", () => {
  const summary = calculateCartSummary("INR", [
    { quantity: 3, unitPriceSnapshot: new Prisma.Decimal("0.10"), product: { prescriptionRequired: false, coldChainRequired: false } },
    { quantity: 2, unitPriceSnapshot: new Prisma.Decimal("0.20"), product: { prescriptionRequired: true, coldChainRequired: true } }
  ]);

  assert.equal(summary.subtotal, "0.70");
  assert.equal(summary.itemCount, 2);
  assert.equal(summary.totalQuantity, 5);
  assert.equal(summary.hasPrescriptionItems, true);
  assert.equal(summary.hasColdChainItems, true);
});

test("returns multiple structured validation issues together", () => {
  const validation = validateCartItems([
    {
      id: "item-1",
      productId: "product-1",
      quantity: 1,
      unitPriceSnapshot: new Prisma.Decimal("10.00"),
      productNameSnapshot: "Old name",
      product: {
        name: "New name",
        price: new Prisma.Decimal("12.00"),
        isActive: false,
        minimumQuantity: 3
      }
    },
    {
      id: "item-2",
      productId: "product-2",
      quantity: 1,
      unitPriceSnapshot: new Prisma.Decimal("10.00"),
      productNameSnapshot: "Missing product",
      product: null
    }
  ]);

  assert.equal(validation.valid, false);
  assert.deepEqual(validation.issues.map((issue) => issue.code), [
    "PRODUCT_INACTIVE",
    "PRICE_CHANGED",
    "MINIMUM_QUANTITY_NOT_MET",
    "PRODUCT_DATA_CHANGED",
    "PRODUCT_NOT_FOUND"
  ]);
});

test("valid minimum quantity passes validation", () => {
  const validation = validateCartItems([
    {
      id: "item-1",
      productId: "product-1",
      quantity: 5,
      unitPriceSnapshot: new Prisma.Decimal("10.00"),
      productNameSnapshot: "Product",
      product: {
        name: "Product",
        price: new Prisma.Decimal("10.00"),
        isActive: true,
        minimumQuantity: 5
      }
    }
  ]);

  assert.deepEqual(validation, { valid: true, issues: [] });
});