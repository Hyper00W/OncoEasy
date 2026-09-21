import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { DeliveryMode, DeliveryStatus, PaymentMethod, PaymentStatus, UserRole } from "@prisma/client";
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
let patientId: string;
let pharmacistId: string;
let otherAgentId: string;
let agentId: string;
let orderId: string;
let deliveryId: string;
let codOrderId: string;
let codDeliveryId: string;
const testKey = `phase1714-${Date.now()}`;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");
  const users = await Promise.all([
    createUser(prisma, "patient", UserRole.PATIENT),
    createUser(prisma, "pharmacist", UserRole.PHARMACIST),
    createUser(prisma, "agent", UserRole.DELIVERY_AGENT),
    createUser(prisma, "other-agent", UserRole.DELIVERY_AGENT)
  ]);
  [patientId, pharmacistId, agentId, otherAgentId] = users.map((user) => user.id);
  const order = await createDelivery(prisma, false);
  orderId = order.orderId;
  deliveryId = order.deliveryId;
  const cod = await createDelivery(prisma, true);
  codOrderId = cod.orderId;
  codDeliveryId = cod.deliveryId;
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
  await prisma.deliveryProof.deleteMany({ where: { delivery: { order: { patientId } } } });
  await prisma.payment.deleteMany({ where: { order: { patientId } } });
  await prisma.order.deleteMany({ where: { patientId } });
  await prisma.product.deleteMany({ where: { sku: { startsWith: testKey } } });
  await prisma.productCategory.deleteMany({ where: { name: { startsWith: testKey } } });
  await prisma.user.deleteMany({ where: { id: { in: [patientId, pharmacistId, agentId, otherAgentId] } } });
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("assignment is pharmacist/admin-only and local-agent scoped", async () => {
  const unauthenticated = await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/assign`, undefined, { agentId });
  const patient = await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/assign`, await tokenFor(patientId), { agentId });
  const assigned = await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/assign`, await tokenFor(pharmacistId, UserRole.PHARMACIST), { agentId });
  const otherAgent = await request("GET", "/api/v1/pharmacy/deliveries/assigned", await tokenFor(otherAgentId, UserRole.DELIVERY_AGENT));
  const ownAgent = await request("GET", "/api/v1/pharmacy/deliveries/assigned", await tokenFor(agentId, UserRole.DELIVERY_AGENT));

  assert.equal(unauthenticated.status, 401);
  assert.equal(patient.status, 403);
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.data.status, DeliveryStatus.ASSIGNED);
  assert.equal(otherAgent.status, 200);
  assert.equal(otherAgent.body.data.length, 0);
  assert.equal(ownAgent.body.data.some((delivery: { id: string }) => delivery.id === deliveryId), true);
});

test("agent cannot access another agent's delivery and lifecycle transitions are guarded", async () => {
  const foreign = await request("GET", `/api/v1/pharmacy/deliveries/${deliveryId}`, await tokenFor(otherAgentId, UserRole.DELIVERY_AGENT));
  const prematureDelivered = await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/delivered`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  const out = await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/out-for-delivery`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  const repeatedOut = await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/out-for-delivery`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));

  assert.equal(foreign.status, 404);
  assert.equal(prematureDelivered.body.error.code, "DELIVERY_STATE_CONFLICT");
  assert.equal(out.status, 200);
  assert.equal(out.body.data.status, DeliveryStatus.OUT_FOR_DELIVERY);
  assert.equal(repeatedOut.status, 409);
});

test("delivery photo is private metadata and required before delivery", async () => {
  const missing = await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/delivered`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  const proof = await uploadProof(deliveryId, agentId, "DELIVERY_PHOTO");
  const delivered = await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/delivered`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  const { prisma } = await import("../src/database/prisma");
  const record = await prisma.delivery.findUnique({ where: { id: deliveryId } });
  const order = await prisma.order.findUnique({ where: { id: orderId } });

  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, "DELIVERY_PROOF_REQUIRED");
  assert.equal(proof.status, 201);
  assert.equal("storageKey" in proof.body.data, false);
  assert.equal(delivered.status, 200);
  assert.equal(record?.status, DeliveryStatus.DELIVERED);
  assert.ok(record?.deliveredAt);
  assert.equal(order?.status, "DELIVERED");
});

test("COD delivery requires payment proof before it can be delivered", async () => {
  const assign = await request("POST", `/api/v1/pharmacy/deliveries/${codDeliveryId}/assign`, await tokenFor(pharmacistId, UserRole.PHARMACIST), { agentId });
  assert.equal(assign.status, 200);
  await request("PATCH", `/api/v1/pharmacy/deliveries/${codDeliveryId}/out-for-delivery`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  await uploadProof(codDeliveryId, agentId, "DELIVERY_PHOTO");
  const missingPaymentProof = await request("PATCH", `/api/v1/pharmacy/deliveries/${codDeliveryId}/delivered`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  const paymentProof = await uploadProof(codDeliveryId, agentId, "CASH_OVER_BILL");
  const delivered = await request("PATCH", `/api/v1/pharmacy/deliveries/${codDeliveryId}/delivered`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));

  assert.equal(missingPaymentProof.status, 400);
  assert.equal(missingPaymentProof.body.error.code, "COD_PROOF_REQUIRED");
  assert.equal(paymentProof.status, 201);
  assert.equal(delivered.status, 200);
});

test("agent can mark an assigned delivery failed with a reason", async () => {
  const assignment = await request("POST", `/api/v1/pharmacy/deliveries/${codDeliveryId}/assign`, await tokenFor(pharmacistId, UserRole.PHARMACIST), { agentId });
  assert.equal(assignment.status, 409);
  const failed = await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/failed`, await tokenFor(agentId, UserRole.DELIVERY_AGENT), { reason: "Recipient unavailable" });
  assert.equal(failed.status, 409);
  assert.equal(failed.body.error.code, "DELIVERY_STATE_CONFLICT");
});

async function createUser(prisma: typeof import("../src/database/prisma").prisma, name: string, role: UserRole) {
  return prisma.user.create({ data: { fullName: `${testKey} ${name}`, email: `${testKey}-${name}@example.com`, phone: `+1555${String(Math.floor(Math.random() * 1_000_0000)).padStart(7, "0")}`, role, isVerified: true } });
}

async function createDelivery(prisma: typeof import("../src/database/prisma").prisma, cod: boolean) {
  const order = await prisma.order.create({
    data: {
      patientId,
      originType: "DIRECT_CART",
      status: "PENDING_PAYMENT",
      currency: "INR",
      subtotal: "100.00",
      deliveryFee: "0.00",
      totalAmount: "100.00",
      items: { create: [{ productId: (await createProduct(prisma)).id, quantity: 1, unitPriceSnapshot: "100.00", productNameSnapshot: "Delivery item" }] },
      payments: cod ? { create: { method: PaymentMethod.COD, status: PaymentStatus.PENDING, amount: "100.00", currency: "INR", provider: "COD" } } : undefined
    }
  });
  const delivery = await prisma.delivery.create({ data: { orderId: order.id, mode: DeliveryMode.LOCAL } });
  return { orderId: order.id, deliveryId: delivery.id };
}

async function createProduct(prisma: typeof import("../src/database/prisma").prisma) {
  const category = await prisma.productCategory.create({ data: { name: `${testKey}-${Math.random()}`, slug: `${testKey}-${Math.random()}` } });
  return prisma.product.create({ data: { sku: `${testKey}-${Math.random()}`, name: "Delivery item", categoryId: category.id, price: "100.00", currency: "INR" } });
}

async function tokenFor(userId: string, role = UserRole.PATIENT) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function uploadProof(deliveryId: string, userId: string, proofType: string) {
  const form = new FormData();
  form.append("proofType", proofType);
  form.append("file", new Blob([Buffer.from("proof")], { type: "image/png" }), `${proofType.toLowerCase()}.png`);
  return request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/proofs`, await tokenFor(userId, UserRole.DELIVERY_AGENT), form);
}

async function request(method: string, path: string, token?: string, body?: BodyInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}`, ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) } : undefined,
    body: body instanceof FormData || body === undefined ? body : JSON.stringify(body)
  });
  return { status: response.status, body: (await response.json()) as any };
}