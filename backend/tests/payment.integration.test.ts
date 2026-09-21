import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { OrderStatus, PaymentStatus, UserRole } from "@prisma/client";
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
let coldChainProductId: string;
let patientId: string;
let otherPatientId: string;
let pharmacistId: string;
const orderIds: string[] = [];
const cartIds: string[] = [];
const testKey = `phase1711-${Date.now()}`;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");
  const category = await prisma.productCategory.create({
    data: { name: `${testKey} Category`, slug: `${testKey}-category` }
  });
  categoryId = category.id;
  const products = await Promise.all([
    prisma.product.create({
      data: { sku: `${testKey}-REGULAR`, name: `yy-${testKey} Regular`, categoryId, price: "10.10", currency: "INR" }
    }),
    prisma.product.create({
      data: { sku: `${testKey}-COLD`, name: `yy-${testKey} Cold`, categoryId, price: "20.20", currency: "INR", coldChainRequired: true, temperatureMinC: "2.00", temperatureMaxC: "8.00", coldChainDeliveryEligible: true }
    })
  ]);
  [regularProductId, coldChainProductId] = products.map((product) => product.id);
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
  await prisma.payment.deleteMany({ where: { order: { patientId: { in: [patientId, otherPatientId] } } } });
  await prisma.order.deleteMany({ where: { patientId: { in: [patientId, otherPatientId] } } });
  await prisma.cart.deleteMany({ where: { patientId: { in: [patientId, otherPatientId] } } });
  await prisma.deliveryPincode.deleteMany({ where: { pincode: { startsWith: testKey } } });
  await prisma.user.deleteMany({ where: { id: { in: [patientId, otherPatientId, pharmacistId] } } });
  await prisma.product.deleteMany({ where: { id: { in: [regularProductId, coldChainProductId] } } });
  await prisma.productCategory.delete({ where: { id: categoryId } });
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("rejects unauthenticated and non-patient payment access", async () => {
  const unauthenticated = await request("POST", "/api/v1/pharmacy/orders/550e8400-e29b-41d4-a716-446655440000/payment", undefined, { method: "PREPAID" });
  const pharmacist = await request("POST", "/api/v1/pharmacy/orders/550e8400-e29b-41d4-a716-446655440000/payment", await tokenFor(pharmacistId, UserRole.PHARMACIST), { method: "PREPAID" });

  assert.equal(unauthenticated.status, 401);
  assert.equal(pharmacist.status, 403);
});

test("prepaid initiation uses the server amount and stays pending", async () => {
  const orderId = await createOrder();
  const response = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, await tokenFor(patientId), { method: "PREPAID", amount: "0.01" });
  const { prisma } = await import("../src/database/prisma");
  const payment = await prisma.payment.findUnique({ where: { orderId } });
  const order = await prisma.order.findUnique({ where: { id: orderId } });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");

  const initiated = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, await tokenFor(patientId), { method: "PREPAID" });
  assert.equal(initiated.status, 201);
  assert.equal(initiated.body.data.status, PaymentStatus.PENDING);
  assert.equal(initiated.body.data.amount, "10.10");
  assert.equal(initiated.body.data.provider, "PENDING_PROVIDER_INTEGRATION");
  assert.equal(payment, null);
  assert.equal(order?.status, OrderStatus.PENDING_PAYMENT);
  orderIds.push(orderId);

  const status = await request("GET", `/api/v1/pharmacy/orders/${orderId}/payment`, await tokenFor(patientId));
  assert.equal(status.status, 200);
  assert.equal(status.body.data.amount, "10.10");
});

test("cold-chain and mixed orders allow prepaid", async () => {
  const coldOrder = await createOrder(coldChainProductId);
  const mixedOrder = await createOrder(regularProductId, coldChainProductId);
  const cold = await request("POST", `/api/v1/pharmacy/orders/${coldOrder}/payment`, await tokenFor(patientId), { method: "PREPAID" });
  const mixed = await request("POST", `/api/v1/pharmacy/orders/${mixedOrder}/payment`, await tokenFor(patientId), { method: "PREPAID" });

  assert.equal(cold.status, 201);
  assert.equal(mixed.status, 201);
  orderIds.push(coldOrder, mixedOrder);
});

test("COD requires an active configured eligible pincode", async () => {
  const noPincode = await createOrder();
  const noPincodeResponse = await request("POST", `/api/v1/pharmacy/orders/${noPincode}/payment`, await tokenFor(patientId), { method: "COD" });
  assert.equal(noPincodeResponse.status, 409);
  assert.equal(noPincodeResponse.body.error.code, "COD_NOT_AVAILABLE_FOR_PINCODE");

  const pincodeSeed = String(Date.now()).slice(-5);
  const inactivePincode = `9${pincodeSeed}1`;
  const ineligiblePincode = `9${pincodeSeed}2`;
  const eligiblePincode = `9${pincodeSeed}3`;
  const { prisma } = await import("../src/database/prisma");
  await prisma.deliveryPincode.createMany({
    data: [
      { pincode: inactivePincode, isActive: false, codEligible: true },
      { pincode: ineligiblePincode, isActive: true, codEligible: false },
      { pincode: eligiblePincode, isActive: true, codEligible: true }
    ]
  });

  const inactiveOrder = await createOrder(undefined, undefined, inactivePincode);
  const ineligibleOrder = await createOrder(undefined, undefined, ineligiblePincode);
  const eligibleOrder = await createOrder(undefined, undefined, eligiblePincode);
  const inactive = await request("POST", `/api/v1/pharmacy/orders/${inactiveOrder}/payment`, await tokenFor(patientId), { method: "COD" });
  const ineligible = await request("POST", `/api/v1/pharmacy/orders/${ineligibleOrder}/payment`, await tokenFor(patientId), { method: "COD" });
  const eligible = await request("POST", `/api/v1/pharmacy/orders/${eligibleOrder}/payment`, await tokenFor(patientId), { method: "COD" });

  assert.equal(inactive.body.error.code, "COD_NOT_AVAILABLE_FOR_PINCODE");
  assert.equal(ineligible.body.error.code, "COD_NOT_AVAILABLE_FOR_PINCODE");
  assert.equal(eligible.status, 201);
  assert.equal(eligible.body.data.status, PaymentStatus.PENDING);
  assert.equal(eligible.body.data.method, "COD");
  orderIds.push(noPincode, inactiveOrder, ineligibleOrder, eligibleOrder);
});

test("payment ownership and order-state rules are enforced", async () => {
  const orderId = await createOrder();
  const foreign = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, await tokenFor(otherPatientId), { method: "PREPAID" });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error.code, "ORDER_NOT_FOUND");

  const { prisma } = await import("../src/database/prisma");
  await prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.PAID } });
  const invalidState = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, await tokenFor(patientId), { method: "PREPAID" });
  assert.equal(invalidState.status, 409);
  assert.equal(invalidState.body.error.code, "ORDER_STATE_CONFLICT");
  orderIds.push(orderId);
});

test("duplicate payment initiation reuses the pending payment safely", async () => {
  const orderId = await createOrder();
  const token = await tokenFor(patientId);
  const [first, second] = await Promise.all([
    request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, token, { method: "PREPAID" }),
    request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, token, { method: "PREPAID" })
  ]);
  const { prisma } = await import("../src/database/prisma");
  const payments = await prisma.payment.count({ where: { orderId } });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(payments, 1);
  orderIds.push(orderId);
});

async function createUser(prisma: typeof import("../src/database/prisma").prisma, name: string, role: UserRole) {
  return prisma.user.create({ data: { fullName: `${testKey} ${name}`, email: `${testKey}-${name}@example.com`, phone: `+1555${String(Math.floor(Math.random() * 1_000_0000)).padStart(7, "0")}`, role, isVerified: true } });
}

async function tokenFor(userId: string, role = UserRole.PATIENT) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function createOrder(firstProductId = regularProductId, secondProductId?: string, deliveryPincode?: string) {
  const { prisma } = await import("../src/database/prisma");
  const cart = await prisma.cart.create({ data: { patientId, currency: "INR" } });
  cartIds.push(cart.id);
  const first = await prisma.product.findUniqueOrThrow({ where: { id: firstProductId } });
  await prisma.cartItem.create({ data: { cartId: cart.id, productId: first.id, quantity: 1, unitPriceSnapshot: first.price, productNameSnapshot: first.name } });
  if (secondProductId) {
    const second = await prisma.product.findUniqueOrThrow({ where: { id: secondProductId } });
    await prisma.cartItem.create({ data: { cartId: cart.id, productId: second.id, quantity: 1, unitPriceSnapshot: second.price, productNameSnapshot: second.name } });
  }
  const response = await request("POST", "/api/v1/pharmacy/orders", await tokenFor(patientId), deliveryPincode ? { deliveryPincode } : {});
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id as string;
}

async function request(method: string, path: string, token?: string, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: (await response.json()) as any };
}