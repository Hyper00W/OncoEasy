import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { OrderStatus, PrescriptionStatus, UserRole } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config({ override: true });
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME?schema=public";
process.env.JWT_ACCESS_SECRET ??= "integration-test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "integration-test-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.JWT_REFRESH_EXPIRES_IN ??= "7d";

let server: Server;
let baseUrl: string;
let categoryId: string;
let regularProductId: string;
let rxProductId: string;
let coldChainProductId: string;
let patientId: string;
let otherPatientId: string;
let pharmacistId: string;
const orderIds: string[] = [];
const prescriptionIds: string[] = [];
const testKey = `phase1710-${Date.now()}`;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");
  const category = await prisma.productCategory.create({
    data: { name: `${testKey} Category`, slug: `${testKey}-category` }
  });
  categoryId = category.id;
  const products = await Promise.all([
    prisma.product.create({
      data: { sku: `${testKey}-REGULAR`, name: `zz-${testKey} Regular`, categoryId, price: "10.10", currency: "INR" }
    }),
    prisma.product.create({
      data: { sku: `${testKey}-RX`, name: `zz-${testKey} Rx`, categoryId, price: "20.20", currency: "INR", prescriptionRequired: true }
    }),
    prisma.product.create({
      data: { sku: `${testKey}-COLD`, name: `zz-${testKey} Cold`, categoryId, price: "0.30", currency: "INR", coldChainRequired: true, temperatureMinC: "2.00", temperatureMaxC: "8.00", coldChainDeliveryEligible: true }
    })
  ]);
  [regularProductId, rxProductId, coldChainProductId] = products.map((product) => product.id);

  const users = await Promise.all([
    createUser(prisma, "patient", UserRole.PATIENT),
    createUser(prisma, "other-patient", UserRole.PATIENT),
    createUser(prisma, "pharmacist", UserRole.PHARMACIST)
  ]);
  [patientId, otherPatientId, pharmacistId] = users.map((user) => user.id);

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
  await prisma.order.deleteMany({ where: { patientId: { in: [patientId, otherPatientId] } } });
  await prisma.prescription.deleteMany({ where: { patientId: { in: [patientId, otherPatientId] } } });
  await prisma.cart.deleteMany({ where: { patientId: { in: [patientId, otherPatientId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [patientId, otherPatientId, pharmacistId] } } });
  await prisma.product.deleteMany({ where: { id: { in: [regularProductId, rxProductId, coldChainProductId] } } });
  await prisma.productCategory.delete({ where: { id: categoryId } });
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("rejects unauthenticated and non-patient order creation", async () => {
  const unauthenticated = await request("POST", "/api/v1/pharmacy/orders", undefined, {});
  const pharmacist = await request("POST", "/api/v1/pharmacy/orders", await tokenFor(pharmacistId, UserRole.PHARMACIST), {});

  assert.equal(unauthenticated.status, 401);
  assert.equal(pharmacist.status, 403);
});

test("rejects missing and empty active carts", async () => {
  const missing = await request("POST", "/api/v1/pharmacy/orders", await tokenFor(patientId), {});
  await createCart(patientId);
  const empty = await request("POST", "/api/v1/pharmacy/orders", await tokenFor(patientId), {});

  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "CART_NOT_FOUND");
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error.code, "CART_EMPTY");
});

test("creates a non-Rx order with server pricing and converts the cart", async () => {
  const cartId = await createCart(patientId);
  await addCartItem(cartId, regularProductId, 2);
  const clientOverride = await request("POST", "/api/v1/pharmacy/orders", await tokenFor(patientId), {
    totalAmount: "0.01"
  });
  const response = await request("POST", "/api/v1/pharmacy/orders", await tokenFor(patientId), {});

  assert.equal(clientOverride.status, 400);
  assert.equal(response.status, 201);
  assert.equal(response.body.data.status, OrderStatus.PENDING_PAYMENT);
  assert.equal(response.body.data.subtotal, "20.20");
  assert.equal(response.body.data.totalAmount, "20.20");
  assert.equal(response.body.data.items[0].unitPrice, "10.10");
  assert.equal(response.body.data.items[0].name, `zz-${testKey} Regular`);
  orderIds.push(response.body.data.id);

  const { prisma } = await import("../src/database/prisma");
  const cart = await prisma.cart.findUnique({ where: { id: cartId }, include: { items: true } });
  assert.equal(cart?.status, "CONVERTED");
  assert.equal(cart?.items.length, 1);
});

test("rejects stale carts without converting them", async () => {
  const cartId = await createCart(patientId);
  await addCartItem(cartId, regularProductId, 1);
  const { prisma } = await import("../src/database/prisma");
  await prisma.product.update({ where: { id: regularProductId }, data: { price: "11.11" } });

  const response = await request("POST", "/api/v1/pharmacy/orders", await tokenFor(patientId), {});
  const cart = await prisma.cart.findUnique({ where: { id: cartId } });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "CART_VALIDATION_FAILED");
  assert.equal(cart?.status, "ACTIVE");
  await prisma.product.update({ where: { id: regularProductId }, data: { price: "10.10" } });
});

test("requires a verified patient-owned prescription for Rx carts", async () => {
  const { prisma } = await import("../src/database/prisma");
  const cartId = await createCart(patientId);
  await addCartItem(cartId, rxProductId, 1);

  const missing = await request("POST", "/api/v1/pharmacy/orders", await tokenFor(patientId), {});
  const foreignPrescription = await prisma.prescription.create({
    data: { patientId: otherPatientId, source: "PATIENT_UPLOAD", status: "VERIFIED", documentKey: `${testKey}/foreign`, documentName: "foreign.pdf", mimeType: "application/pdf" }
  });
  const wrongOwner = await request("POST", "/api/v1/pharmacy/orders", await tokenFor(patientId), { prescriptionId: foreignPrescription.id });
  const pending = await createPrescription(patientId, PrescriptionStatus.PENDING_REVIEW);
  const pendingResponse = await request("POST", "/api/v1/pharmacy/orders", await tokenFor(patientId), { prescriptionId: pending });
  const queried = await createPrescription(patientId, PrescriptionStatus.QUERY);
  const queriedResponse = await request("POST", "/api/v1/pharmacy/orders", await tokenFor(patientId), { prescriptionId: queried });

  assert.equal(missing.body.error.code, "PRESCRIPTION_REQUIRED");
  assert.equal(wrongOwner.body.error.code, "PRESCRIPTION_NOT_FOUND");
  assert.equal(pendingResponse.body.error.code, "PRESCRIPTION_NOT_VERIFIED");
  assert.equal(queriedResponse.body.error.code, "PRESCRIPTION_NOT_VERIFIED");
});

test("verified Rx prescription allows order and remains associated", async () => {
  const cartId = await createCart(patientId);
  await addCartItem(cartId, rxProductId, 1);
  const prescriptionId = await createPrescription(patientId, PrescriptionStatus.VERIFIED);
  const response = await request("POST", "/api/v1/pharmacy/orders", await tokenFor(patientId), { prescriptionId });

  assert.equal(response.status, 201);
  assert.equal(response.body.data.status, OrderStatus.PENDING_PAYMENT);
  assert.deepEqual(response.body.data.prescription, { id: prescriptionId });
  orderIds.push(response.body.data.id);
});

test("mixed regular and cold-chain cart remains one order", async () => {
  const cartId = await createCart(patientId);
  await addCartItem(cartId, regularProductId, 1);
  await addCartItem(cartId, coldChainProductId, 2);
  const response = await request("POST", "/api/v1/pharmacy/orders", await tokenFor(patientId), {});

  assert.equal(response.status, 201);
  assert.equal(response.body.data.items.length, 2);
  assert.equal(response.body.data.items[1].quantity, 2);
  orderIds.push(response.body.data.id);
});

test("patients can read only their own orders", async () => {
  const own = await request("GET", "/api/v1/pharmacy/orders", await tokenFor(patientId));
  assert.equal(own.status, 200);
  assert.equal(own.body.data.some((order: { id: string }) => orderIds.includes(order.id)), true);

  const other = await request("GET", `/api/v1/pharmacy/orders/${orderIds[0]}`, await tokenFor(otherPatientId));
  assert.equal(other.status, 404);
  assert.equal(other.body.error.code, "ORDER_NOT_FOUND");
});

test("concurrent order creation produces one order and one conflict", async () => {
  const cartId = await createCart(patientId);
  await addCartItem(cartId, regularProductId, 1);
  const token = await tokenFor(patientId);
  const [first, second] = await Promise.all([
    request("POST", "/api/v1/pharmacy/orders", token, {}),
    request("POST", "/api/v1/pharmacy/orders", token, {})
  ]);
  const responses = [first, second];
  const successful = responses.find((response) => response.status === 201);
  const conflict = responses.find((response) => response.status !== 201);

  assert.ok(successful);
  assert.ok(conflict);
  assert.equal(conflict.status === 404 || conflict.status === 409, true);
  assert.equal(successful.body.data.status, OrderStatus.PENDING_PAYMENT);
  orderIds.push(successful.body.data.id);
});

async function createUser(prisma: typeof import("../src/database/prisma").prisma, name: string, role: UserRole) {
  return prisma.user.create({
    data: { fullName: `${testKey} ${name}`, email: `${testKey}-${name}@example.com`, phone: `+1555${String(Math.floor(Math.random() * 1_000_0000)).padStart(7, "0")}`, role, isVerified: true }
  });
}

async function tokenFor(userId: string, role = UserRole.PATIENT) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function createCart(ownerId: string) {
  const { prisma } = await import("../src/database/prisma");
  await prisma.cart.deleteMany({ where: { patientId: ownerId, status: "ACTIVE" } });
  return (await prisma.cart.create({ data: { patientId: ownerId, currency: "INR" } })).id;
}

async function addCartItem(cartId: string, productId: string, quantity: number, snapshotPrice?: string, snapshotName?: string) {
  const { prisma } = await import("../src/database/prisma");
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  await prisma.cartItem.create({ data: { cartId, productId, quantity, unitPriceSnapshot: snapshotPrice ?? product.price, productNameSnapshot: snapshotName ?? product.name } });
}

async function createPrescription(ownerId: string, status: PrescriptionStatus) {
  const { prisma } = await import("../src/database/prisma");
  const prescription = await prisma.prescription.create({
    data: { patientId: ownerId, source: "PATIENT_UPLOAD", status, documentKey: `${testKey}/${status}/${Math.random()}`, documentName: "prescription.pdf", mimeType: "application/pdf" }
  });
  prescriptionIds.push(prescription.id);
  return prescription.id;
}

async function request(method: string, path: string, token?: string, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: (await response.json()) as any };
}