import assert from "node:assert/strict";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";

import {
  cartItemInputSchema,
  prescriptionInputSchema,
  prescriptionSourceSchema,
  prescriptionStatusSchema
} from "../src/modules/pharmacy/cart-prescription-validation";

const prisma = new PrismaClient();
const testSuffix = Date.now().toString();
let patientId: string;
let categoryId: string;
let productId: string;
let cartId: string;

test("valid cart item passes validation", () => {
  const result = cartItemInputSchema.safeParse({
    cartId: "550e8400-e29b-41d4-a716-446655440000",
    productId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    quantity: 2,
    unitPriceSnapshot: 125.5,
    productNameSnapshot: "Sample product"
  });

  assert.equal(result.success, true);
});

test("cart quantity below one is rejected", () => {
  const result = cartItemInputSchema.safeParse({
    cartId: "550e8400-e29b-41d4-a716-446655440000",
    productId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    quantity: 0,
    unitPriceSnapshot: 125.5,
    productNameSnapshot: "Sample product"
  });

  assert.equal(result.success, false);
});

test("prescription sources and statuses accept only the defined enum values", () => {
  for (const source of ["PATIENT_UPLOAD", "PHARMACIST_CREATED_CART", "DOCTOR_CALLBACK"]) {
    assert.equal(prescriptionSourceSchema.safeParse(source).success, true);
  }

  for (const status of ["UPLOADED", "PENDING_REVIEW", "VERIFIED", "REJECTED", "EXPIRED", "USED"]) {
    assert.equal(prescriptionStatusSchema.safeParse(status).success, true);
  }

  assert.equal(prescriptionSourceSchema.safeParse("UNKNOWN").success, false);
  assert.equal(prescriptionStatusSchema.safeParse("UNKNOWN").success, false);
});

test("future pharmacist and doctor references may remain nullable", () => {
  const result = prescriptionInputSchema.safeParse({
    patientId: "550e8400-e29b-41d4-a716-446655440000",
    source: "PATIENT_UPLOAD",
    documentKey: "prescriptions/example.pdf",
    documentName: "example.pdf",
    mimeType: "application/pdf",
    createdByUserId: null,
    reviewedByUserId: null,
    doctorId: null
  });

  assert.equal(result.success, true);
});

test("cart item product uniqueness is enforced by the database", async () => {
  patientId = (
    await prisma.user.create({
      data: {
        fullName: "Step 1.7.4 test patient",
        email: `step174-${testSuffix}@example.com`,
        phone: `+1555300${testSuffix.slice(-6)}`,
        role: "PATIENT",
        isVerified: true
      }
    })
  ).id;

  categoryId = (
    await prisma.productCategory.create({
      data: {
        name: `Step 1.7.4 category ${testSuffix}`,
        slug: `step-174-${testSuffix}`
      }
    })
  ).id;

  productId = (
    await prisma.product.create({
      data: {
        sku: `STEP174-${testSuffix}`,
        name: "Step 1.7.4 product",
        categoryId,
        price: 100,
        currency: "INR"
      }
    })
  ).id;

  cartId = (
    await prisma.cart.create({
      data: {
        patientId,
        currency: "INR"
      }
    })
  ).id;

  await prisma.cartItem.create({
    data: {
      cartId,
      productId,
      quantity: 1,
      unitPriceSnapshot: 100,
      productNameSnapshot: "Step 1.7.4 product"
    }
  });

  await assert.rejects(
    prisma.cartItem.create({
      data: {
        cartId,
        productId,
        quantity: 2,
        unitPriceSnapshot: 100,
        productNameSnapshot: "Step 1.7.4 product"
      }
    }),
    (error: { code?: string }) => error.code === "P2002"
  );
});

after(async () => {
  if (cartId) {
    await prisma.cart.delete({ where: { id: cartId } });
  }
  if (productId) {
    await prisma.product.delete({ where: { id: productId } });
  }
  if (categoryId) {
    await prisma.productCategory.delete({ where: { id: categoryId } });
  }
  if (patientId) {
    await prisma.user.delete({ where: { id: patientId } });
  }
  await prisma.$disconnect();
});
