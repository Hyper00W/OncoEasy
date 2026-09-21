import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { DeliveryMode, DeliveryPolicyType, DeliveryStatus, UserRole } from "@prisma/client";
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
let coldProductId: string;
let patientId: string;
let otherPatientId: string;
let pharmacistId: string;
let localPincode: string;
let courierPincode: string;
let coldPincode: string;
let inactivePincode: string;
let noModePincode: string;
const testKey = `phase1712-${Date.now()}`;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");
  const category = await prisma.productCategory.create({ data: { name: `${testKey} Category`, slug: `${testKey}-category` } });
  categoryId = category.id;
  const products = await Promise.all([
    prisma.product.create({ data: { sku: `${testKey}-REGULAR`, name: `xx-${testKey} Regular`, categoryId, price: "100.00", currency: "INR" } }),
    prisma.product.create({ data: { sku: `${testKey}-COLD`, name: `xx-${testKey} Cold`, categoryId, price: "50.00", currency: "INR", coldChainRequired: true, temperatureMinC: "2.00", temperatureMaxC: "8.00", minimumQuantity: 2 } })
  ]);
  [regularProductId, coldProductId] = products.map((product) => product.id);
  const suffix = String(Date.now()).slice(-5);
  localPincode = `8${suffix}1`;
  courierPincode = `8${suffix}2`;
  coldPincode = `8${suffix}3`;
  inactivePincode = `8${suffix}4`;
  noModePincode = `8${suffix}5`;
  await prisma.deliveryPincode.createMany({
    data: [
      { pincode: localPincode, localDeliveryEligible: true, courierDeliveryEligible: true, coldChainEligible: false, codEligible: false },
      { pincode: courierPincode, courierDeliveryEligible: true, coldChainEligible: false, codEligible: true },
      { pincode: coldPincode, courierDeliveryEligible: true, coldChainEligible: true, codEligible: false },
      { pincode: inactivePincode, localDeliveryEligible: true, isActive: false },
      { pincode: noModePincode, isActive: true }
    ]
  });
  await prisma.deliveryPolicy.createMany({
    data: [
      { type: DeliveryPolicyType.REGULAR, minimumOrderValueForFreeDelivery: "150.00", deliveryFee: "25.50" },
      { type: DeliveryPolicyType.COLD_CHAIN, minimumOrderValueForFreeDelivery: "200.00", deliveryFee: "40.75" }
    ]
  });
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
  await prisma.cart.deleteMany({ where: { patientId: { in: [patientId, otherPatientId] } } });
  await prisma.deliveryPincode.deleteMany({ where: { pincode: { in: [localPincode, courierPincode, coldPincode, inactivePincode, noModePincode] } } });
  await prisma.deliveryPolicy.deleteMany({ where: { type: { in: [DeliveryPolicyType.REGULAR, DeliveryPolicyType.COLD_CHAIN] } } });
  await prisma.user.deleteMany({ where: { id: { in: [patientId, otherPatientId, pharmacistId] } } });
  await prisma.product.deleteMany({ where: { id: { in: [regularProductId, coldProductId] } } });
  await prisma.productCategory.delete({ where: { id: categoryId } });
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("rejects unauthenticated, non-patient, invalid, unknown, inactive, and unconfigured pincodes", async () => {
  const orderId = await createOrder(regularProductId);
  const unauthenticated = await request("PATCH", `/api/v1/pharmacy/orders/${orderId}/delivery-pincode`, undefined, { pincode: "110001" });
  const pharmacist = await request("PATCH", `/api/v1/pharmacy/orders/${orderId}/delivery-pincode`, await tokenFor(pharmacistId, UserRole.PHARMACIST), { pincode: "110001" });
  const invalid = await request("PATCH", `/api/v1/pharmacy/orders/${orderId}/delivery-pincode`, await tokenFor(patientId), { pincode: "123" });
  const unknown = await validate(orderId, "110001");
  const inactiveOrder = await createOrder(regularProductId, inactivePincode);
  const inactive = await validate(inactiveOrder);

  assert.equal(unauthenticated.status, 401);
  assert.equal(pharmacist.status, 403);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "VALIDATION_ERROR");
  assert.equal(unknown.body.error.code, "DELIVERY_NOT_SERVICEABLE");
  assert.equal(inactive.body.error.code, "DELIVERY_NOT_SERVICEABLE");
});

test("selects LOCAL when configured and calculates a regular fee", async () => {
  const orderId = await createOrder(regularProductId, localPincode);
  const response = await validate(orderId);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.deliveryMode, DeliveryMode.LOCAL);
  assert.equal(response.body.data.deliveryFee, "25.50");
  assert.equal(response.body.data.freeDeliveryEligible, false);
  assert.equal(response.body.data.codAvailable, false);
  assert.equal(response.body.data.delivery.status, DeliveryStatus.PENDING);
});

test("selects COURIER when local delivery is unavailable", async () => {
  const orderId = await createOrder(regularProductId, courierPincode);
  const response = await validate(orderId);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.deliveryMode, DeliveryMode.COURIER);
  assert.equal(response.body.data.codAvailable, true);
});

test("requires configured delivery mode and keeps COD separate", async () => {
  const orderId = await createOrder(regularProductId, noModePincode);
  const response = await validate(orderId);
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "DELIVERY_NOT_SERVICEABLE");
});

test("cold-chain and mixed orders require cold-chain serviceability", async () => {
  const rejectedOrder = await createOrder(coldProductId, courierPincode);
  const rejected = await validate(rejectedOrder);
  assert.equal(rejected.body.error.code, "COLD_CHAIN_NOT_SERVICEABLE");

  const coldOrder = await createOrder(coldProductId, coldPincode);
  const cold = await validate(coldOrder);
  assert.equal(cold.status, 200);
  assert.equal(cold.body.data.policyType, DeliveryPolicyType.COLD_CHAIN);
  assert.equal(cold.body.data.deliveryFee, "40.75");

  const mixedOrder = await createOrder(regularProductId, coldPincode, coldProductId);
  const mixed = await validate(mixedOrder);
  assert.equal(mixed.status, 200);
  assert.equal(mixed.body.data.policyType, DeliveryPolicyType.COLD_CHAIN);
});

test("free delivery threshold and Decimal total update are server-side", async () => {
  const orderId = await createOrder(regularProductId, localPincode, regularProductId);
  const response = await validate(orderId, undefined, { deliveryFee: "0.01", totalAmount: "0.01" });
  const { prisma } = await import("../src/database/prisma");
  const order = await prisma.order.findUnique({ where: { id: orderId } });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.freeDeliveryEligible, true);
  assert.equal(response.body.data.deliveryFee, "0.00");
  assert.equal(response.body.data.totalAmount, "200.00");
  assert.equal(order?.deliveryFee.toFixed(2), "0.00");
  assert.equal(order?.totalAmount.toFixed(2), "200.00");
});

test("missing delivery policy returns a configuration error", async () => {
  const { prisma } = await import("../src/database/prisma");
  await prisma.deliveryPolicy.delete({ where: { type: DeliveryPolicyType.REGULAR } });
  const orderId = await createOrder(regularProductId, localPincode);
  const response = await validate(orderId);
  await prisma.deliveryPolicy.create({ data: { type: DeliveryPolicyType.REGULAR, minimumOrderValueForFreeDelivery: "150.00", deliveryFee: "25.50" } });

  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, "DELIVERY_POLICY_NOT_CONFIGURED");
});

test("ownership, order state, and repeated validation are protected", async () => {
  const orderId = await createOrder(regularProductId, localPincode);
  const foreign = await request("POST", `/api/v1/pharmacy/orders/${orderId}/delivery/validate`, await tokenFor(otherPatientId));
  const first = await validate(orderId);
  const second = await validate(orderId);
  const { prisma } = await import("../src/database/prisma");
  const deliveryCount = await prisma.delivery.count({ where: { orderId } });
  await prisma.order.update({ where: { id: orderId }, data: { status: "PAID" } });
  const invalidState = await validate(orderId);

  assert.equal(foreign.status, 404);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(deliveryCount, 1);
  assert.equal(invalidState.body.error.code, "ORDER_STATE_CONFLICT");
});

async function createUser(prisma: typeof import("../src/database/prisma").prisma, name: string, role: UserRole) {
  return prisma.user.create({ data: { fullName: `${testKey} ${name}`, email: `${testKey}-${name}@example.com`, phone: `+1555${String(Math.floor(Math.random() * 1_000_0000)).padStart(7, "0")}`, role, isVerified: true } });
}

async function tokenFor(userId: string, role = UserRole.PATIENT) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function createOrder(firstProductId: string, pincode?: string, secondProductId?: string) {
  const { prisma } = await import("../src/database/prisma");
  await prisma.cart.deleteMany({ where: { patientId, status: "ACTIVE" } });
  const cart = await prisma.cart.create({ data: { patientId, currency: "INR" } });
  const first = await prisma.product.findUniqueOrThrow({ where: { id: firstProductId } });
  await prisma.cartItem.create({ data: { cartId: cart.id, productId: first.id, quantity: secondProductId === firstProductId ? first.minimumQuantity * 2 : first.minimumQuantity, unitPriceSnapshot: first.price, productNameSnapshot: first.name } });
  if (secondProductId && secondProductId !== firstProductId) {
    const second = await prisma.product.findUniqueOrThrow({ where: { id: secondProductId } });
    await prisma.cartItem.create({ data: { cartId: cart.id, productId: second.id, quantity: second.minimumQuantity, unitPriceSnapshot: second.price, productNameSnapshot: second.name } });
  }
  const response = await request("POST", "/api/v1/pharmacy/orders", await tokenFor(patientId), pincode ? { deliveryPincode: pincode } : {});
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id as string;
}

async function validate(orderId: string, pincode?: string, body?: Record<string, unknown>) {
  if (pincode) {
    const update = await request("PATCH", `/api/v1/pharmacy/orders/${orderId}/delivery-pincode`, await tokenFor(patientId), { pincode });
    assert.equal(update.status, 200, JSON.stringify(update.body));
  }
  return request("POST", `/api/v1/pharmacy/orders/${orderId}/delivery/validate`, await tokenFor(patientId), body);
}

async function request(method: string, path: string, token?: string, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: (await response.json()) as any };
}