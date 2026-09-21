import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { CartStatus, UserRole } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config({ override: true });
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME?schema=public";
process.env.JWT_ACCESS_SECRET ??= "integration-test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "integration-test-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.JWT_REFRESH_EXPIRES_IN ??= "7d";

let server: Server;
let baseUrl: string;
let categoryId: string;
let activeProductId: string;
let minimumProductId: string;
let inactiveProductId: string;
let prescriptionProductId: string;
let coldChainProductId: string;
let missingProductId: string;
let patientId: string;
let otherPatientId: string;
let summaryPatientId: string;
let professionalId: string;
const testKey = `phase176-${Date.now()}`;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");

  const category = await prisma.productCategory.create({
    data: { name: `${testKey} Category`, slug: `${testKey}-category` }
  });
  categoryId = category.id;

  const products = await Promise.all([
    prisma.product.create({
      data: {
        sku: `${testKey}-ACTIVE`,
        name: `${testKey} Original Name`,
        categoryId,
        price: "450.00",
        currency: "INR",
        unitLabel: "box"
      }
    }),
    prisma.product.create({
      data: {
        sku: `${testKey}-MINIMUM`,
        name: `${testKey} Minimum Product`,
        categoryId,
        price: "12.34",
        currency: "INR",
        minimumQuantity: 3
      }
    }),
    prisma.product.create({
      data: {
        sku: `${testKey}-INACTIVE`,
        name: `${testKey} Inactive`,
        categoryId,
        price: "10.00",
        currency: "INR",
        isActive: false
      }
    }),
    prisma.product.create({
      data: {
        sku: `${testKey}-RX`,
        name: `${testKey} Prescription`,
        categoryId,
        price: "0.10",
        currency: "INR",
        prescriptionRequired: true
      }
    }),
    prisma.product.create({
      data: {
        sku: `${testKey}-COLD`,
        name: `${testKey} Cold Chain`,
        categoryId,
        price: "0.20",
        currency: "INR",
        coldChainRequired: true,
        temperatureMinC: "2.00",
        temperatureMaxC: "8.00",
        coldChainDeliveryEligible: true
      }
    })
  ]);
  [activeProductId, minimumProductId, inactiveProductId, prescriptionProductId, coldChainProductId] = products.map((product) => product.id);
  missingProductId = "550e8400-e29b-41d4-a716-446655440000";

  const users = await Promise.all([
    createUser(prisma, "patient", UserRole.PATIENT),
    createUser(prisma, "other-patient", UserRole.PATIENT),
    createUser(prisma, "summary-patient", UserRole.PATIENT),
    createUser(prisma, "professional", UserRole.PHARMACIST)
  ]);
  [patientId, otherPatientId, summaryPatientId, professionalId] = users.map((user) => user.id);

  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const { address: host, port } = address as AddressInfo;
  baseUrl = `http://${host}:${port}`;
});

after(async () => {
  const { prisma } = await import("../src/database/prisma");
  await prisma.cart.deleteMany({ where: { patientId: { in: [patientId, otherPatientId, summaryPatientId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [patientId, otherPatientId, summaryPatientId, professionalId] } } });
  await prisma.product.deleteMany({ where: { id: { in: [activeProductId, minimumProductId, inactiveProductId, prescriptionProductId, coldChainProductId] } } });
  await prisma.productCategory.delete({ where: { id: categoryId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("rejects unauthenticated and non-patient cart access", async () => {
  const unauthenticated = await request("GET", "/api/v1/pharmacy/cart");
  const professional = await request(
    "GET",
    "/api/v1/pharmacy/cart",
    await tokenFor(professionalId, UserRole.PHARMACIST)
  );

  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.body.error.code, "UNAUTHORIZED");
  assert.equal(professional.status, 403);
  assert.equal(professional.body.error.code, "FORBIDDEN");
});

test("patient gets an empty cart representation", async () => {
  const response = await request("GET", "/api/v1/pharmacy/cart", await tokenFor(patientId));

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    success: true,
    data: {
      id: null,
      status: "ACTIVE",
      currency: null,
      items: [],
      summary: {
        subtotal: "0.00",
        itemCount: 0,
        totalQuantity: 0,
        currency: null,
        hasPrescriptionItems: false,
        hasColdChainItems: false
      },
      validation: { valid: true, issues: [] }
    }
  });
});

test("adds an item, creates an active cart, and preserves database snapshots", async () => {
  const response = await request("POST", "/api/v1/pharmacy/cart/items", await tokenFor(patientId), {
    productId: activeProductId,
    quantity: 1,
    price: "0.01"
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");

  const added = await request("POST", "/api/v1/pharmacy/cart/items", await tokenFor(patientId), {
    productId: activeProductId,
    quantity: 1
  });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.equal(added.body.data.status, "ACTIVE");
  assert.equal(added.body.data.items[0].name, `${testKey} Original Name`);
  assert.equal(added.body.data.items[0].unitPrice, "450.00");

  const { prisma } = await import("../src/database/prisma");
  await prisma.product.update({
    where: { id: activeProductId },
    data: { name: `${testKey} Changed Name`, price: "999.99" }
  });
  const cart = await request("GET", "/api/v1/pharmacy/cart", await tokenFor(patientId));
  assert.equal(cart.body.data.items[0].name, `${testKey} Original Name`);
  assert.equal(cart.body.data.items[0].unitPrice, "450.00");
  assert.equal(cart.body.data.items[0].currentUnitPrice, "999.99");
  assert.equal(cart.body.data.validation.valid, false);
  assert.deepEqual(
    cart.body.data.validation.issues.map((issue: { code: string }) => issue.code).sort(),
    ["PRICE_CHANGED", "PRODUCT_DATA_CHANGED"]
  );
});

test("increments an existing item instead of creating a duplicate", async () => {
  const response = await request("POST", "/api/v1/pharmacy/cart/items", await tokenFor(patientId), {
    productId: activeProductId,
    quantity: 2
  });

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.items.length, 1);
  assert.equal(response.body.data.items[0].quantity, 3);
});

test("enforces minimum quantity and rejects inactive or missing products", async () => {
  const belowMinimum = await request("POST", "/api/v1/pharmacy/cart/items", await tokenFor(patientId), {
    productId: minimumProductId,
    quantity: 1
  });
  const inactive = await request("POST", "/api/v1/pharmacy/cart/items", await tokenFor(patientId), {
    productId: inactiveProductId,
    quantity: 1
  });
  const missing = await request("POST", "/api/v1/pharmacy/cart/items", await tokenFor(patientId), {
    productId: missingProductId,
    quantity: 1
  });

  assert.equal(belowMinimum.status, 400);
  assert.equal(belowMinimum.body.error.code, "MINIMUM_QUANTITY_NOT_MET");
  assert.equal(inactive.body.error.code, "PRODUCT_NOT_FOUND");
  assert.equal(missing.body.error.code, "PRODUCT_NOT_FOUND");
});

test("updates and removes only the authenticated patient's item", async () => {
  const otherPatientCart = await request(
    "GET",
    "/api/v1/pharmacy/cart",
    await tokenFor(otherPatientId)
  );
  assert.deepEqual(otherPatientCart.body.data.items, []);

  const updated = await request(
    "PATCH",
    `/api/v1/pharmacy/cart/items/${activeProductId}`,
    await tokenFor(patientId),
    { quantity: 4 }
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.items[0].quantity, 4);

  const otherPatientUpdate = await request(
    "PATCH",
    `/api/v1/pharmacy/cart/items/${activeProductId}`,
    await tokenFor(otherPatientId),
    { quantity: 2 }
  );
  assert.equal(otherPatientUpdate.status, 404);
  assert.equal(otherPatientUpdate.body.error.code, "CART_NOT_FOUND");

  const removed = await request(
    "DELETE",
    `/api/v1/pharmacy/cart/items/${activeProductId}`,
    await tokenFor(patientId)
  );
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.data.items, []);
});

test("validates UUIDs and quantities", async () => {
  const invalidUuid = await request("PATCH", "/api/v1/pharmacy/cart/items/not-a-uuid", await tokenFor(patientId), {
    quantity: 1
  });
  const invalidQuantity = await request("POST", "/api/v1/pharmacy/cart/items", await tokenFor(patientId), {
    productId: activeProductId,
    quantity: 0
  });

  assert.equal(invalidUuid.status, 400);
  assert.equal(invalidQuantity.status, 400);
  assert.equal(invalidUuid.body.error.code, "VALIDATION_ERROR");
  assert.equal(invalidQuantity.body.error.code, "VALIDATION_ERROR");
});

test("calculates Decimal-safe mixed-cart summary without blocking it", async () => {
  const rx = await request("POST", "/api/v1/pharmacy/cart/items", await tokenFor(summaryPatientId), {
    productId: prescriptionProductId,
    quantity: 3
  });
  const coldChain = await request("POST", "/api/v1/pharmacy/cart/items", await tokenFor(summaryPatientId), {
    productId: coldChainProductId,
    quantity: 2
  });
  const cart = await request("GET", "/api/v1/pharmacy/cart", await tokenFor(summaryPatientId));

  assert.equal(rx.status, 200);
  assert.equal(coldChain.status, 200);
  assert.equal(cart.status, 200);
  assert.deepEqual(cart.body.data.summary, {
    subtotal: "0.70",
    itemCount: 2,
    totalQuantity: 5,
    currency: "INR",
    hasPrescriptionItems: true,
    hasColdChainItems: true
  });
  assert.equal(cart.body.data.validation.valid, true);
  assert.equal(cart.body.data.items[1].temperatureMinC, "2");
  assert.equal(cart.body.data.items[1].temperatureMaxC, "8");
  assert.equal(cart.body.data.items[1].coldChainDeliveryEligible, true);
});

test("clears active items without deleting a converted cart", async () => {
  const { prisma } = await import("../src/database/prisma");
  const converted = await prisma.cart.create({
    data: {
      patientId,
      currency: "INR",
      status: CartStatus.CONVERTED,
      items: {
        create: {
          productId: activeProductId,
          quantity: 1,
          unitPriceSnapshot: "450.00",
          productNameSnapshot: `${testKey} Historical`
        }
      }
    }
  });
  await prisma.cart.create({ data: { patientId, currency: "INR" } });

  const cleared = await request("DELETE", "/api/v1/pharmacy/cart", await tokenFor(patientId));
  const historical = await prisma.cart.findUnique({ where: { id: converted.id }, include: { items: true } });

  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body.data.items, []);
  assert.ok(historical);
  assert.equal(historical.status, CartStatus.CONVERTED);
  assert.equal(historical.items.length, 1);
});

async function createUser(prisma: typeof import("../src/database/prisma").prisma, name: string, role: UserRole) {
  return prisma.user.create({
    data: {
      fullName: `${testKey} ${name}`,
      email: `${testKey}-${name}@example.com`,
      phone: `+1555${String(Math.floor(Math.random() * 1_000_0000)).padStart(7, "0")}`,
      role,
      isVerified: true
    }
  });
}

async function tokenFor(userId: string, role = UserRole.PATIENT) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function request(method: string, path: string, token?: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  return { status: response.status, body: (await response.json()) as any };
}