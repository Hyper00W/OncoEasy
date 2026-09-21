import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { DeliveryMode, DeliveryProofType, DeliveryStatus, OrderStatus, ReferralStatus, UserRole } from "@prisma/client";
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
let productId: string;
let patientId: string;
let otherPatientId: string;
let doctorId: string;
let otherDoctorId: string;
let agentId: string;
let referralId: string;
let accessToken: string;
let orderId: string;
const testKey = `phase18-${Date.now()}`;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");
  const category = await prisma.productCategory.create({ data: { name: `${testKey} Category`, slug: `${testKey}-category` } });
  categoryId = category.id;
  const product = await prisma.product.create({ data: { sku: `${testKey}-PRODUCT`, name: `${testKey} Medicine`, categoryId, price: "12.50", currency: "INR", minimumQuantity: 2 } });
  productId = product.id;
  const users = await Promise.all([
    createUser(prisma, "patient", UserRole.PATIENT),
    createUser(prisma, "other-patient", UserRole.PATIENT),
    createUser(prisma, "doctor", UserRole.DOCTOR),
    createUser(prisma, "other-doctor", UserRole.DOCTOR),
    createUser(prisma, "agent", UserRole.DELIVERY_AGENT)
  ]);
  [patientId, otherPatientId, doctorId, otherDoctorId, agentId] = users.map((user) => user.id);
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
  await prisma.deliveryProof.deleteMany({ where: { delivery: { order: { referralId } } } });
  await prisma.delivery.deleteMany({ where: { order: { referralId } } });
  await prisma.order.deleteMany({ where: { referralId } });
  await prisma.referral.deleteMany({ where: { id: referralId } });
  await prisma.cart.deleteMany({ where: { patientId: { in: [patientId, otherPatientId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [patientId, otherPatientId, doctorId, otherDoctorId, agentId] } } });
  await prisma.product.delete({ where: { id: productId } });
  await prisma.productCategory.delete({ where: { id: categoryId } });
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("referral creation is doctor-only and validates patient and product", async () => {
  const unauthenticated = await request("POST", "/api/v1/referrals", undefined, referralInput());
  const patient = await request("POST", "/api/v1/referrals", await tokenFor(patientId), referralInput());
  const missingPatient = await request("POST", "/api/v1/referrals", await tokenFor(doctorId, UserRole.DOCTOR), { patientId: "550e8400-e29b-41d4-a716-446655440000", items: [{ productId, quantity: 2 }] });
  const missingProduct = await request("POST", "/api/v1/referrals", await tokenFor(doctorId, UserRole.DOCTOR), { patientId, items: [{ productId: "550e8400-e29b-41d4-a716-446655440000", quantity: 2 }] });
  const invalidQuantity = await request("POST", "/api/v1/referrals", await tokenFor(doctorId, UserRole.DOCTOR), { patientId, items: [{ productId, quantity: 1 }] });

  assert.equal(unauthenticated.status, 401);
  assert.equal(patient.status, 403);
  assert.equal(missingPatient.body.error.code, "PATIENT_NOT_FOUND");
  assert.equal(missingProduct.body.error.code, "PRODUCT_NOT_FOUND");
  assert.equal(invalidQuantity.body.error.code, "MINIMUM_QUANTITY_NOT_MET");

  const created = await request("POST", "/api/v1/referrals", await tokenFor(doctorId, UserRole.DOCTOR), referralInput());
  assert.equal(created.status, 201, JSON.stringify(created.body));
  referralId = created.body.data.referralId;
  accessToken = created.body.data.accessToken;
  assert.equal(created.body.data.status, ReferralStatus.SENT);
  assert.equal(created.body.data.items[0].quantity, 2);
  assert.equal(typeof accessToken, "string");
});

test("doctor ownership and patient ownership are enforced", async () => {
  const doctorList = await request("GET", "/api/v1/referrals", await tokenFor(doctorId, UserRole.DOCTOR));
  const foreignDoctor = await request("GET", `/api/v1/referrals/${referralId}`, await tokenFor(otherDoctorId, UserRole.DOCTOR));
  const foreignPatient = await request("GET", `/api/v1/referrals/access/${accessToken}`, await tokenFor(otherPatientId));
  const invalidToken = await request("GET", `/api/v1/referrals/access/${"a".repeat(64)}`, await tokenFor(patientId));

  assert.equal(doctorList.status, 200);
  assert.equal(doctorList.body.data.some((referral: { referralId: string }) => referral.referralId === referralId), true);
  assert.equal(foreignDoctor.status, 404);
  assert.equal(foreignPatient.status, 404);
  assert.equal(invalidToken.status, 404);
});

test("patient access transitions SENT to VIEWED and adds referral medicines to the existing cart", async () => {
  const viewed = await request("GET", `/api/v1/referrals/access/${accessToken}`, await tokenFor(patientId));
  assert.equal(viewed.status, 200, JSON.stringify(viewed.body));
  assert.equal(viewed.body.data.status, ReferralStatus.VIEWED);

  const added = await request("POST", `/api/v1/referrals/access/${accessToken}/cart`, await tokenFor(patientId));
  assert.equal(added.status, 200, JSON.stringify(added.body));
  const cart = await request("GET", "/api/v1/pharmacy/cart", await tokenFor(patientId));
  assert.equal(cart.body.data.items[0].productId, productId);
  assert.equal(cart.body.data.items[0].quantity, 2);
});

test("referral order reuses the patient cart and transitions VIEWED to ORDERED", async () => {
  const response = await request("POST", "/api/v1/pharmacy/orders", await tokenFor(patientId), { referralToken: accessToken });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  orderId = response.body.data.id;
  assert.equal(response.body.data.originType, "REFERRAL");
  assert.equal(response.body.data.status, OrderStatus.PENDING_PAYMENT);

  const repeated = await request("POST", "/api/v1/pharmacy/orders", await tokenFor(patientId), { referralToken: accessToken });
  assert.equal(repeated.status, 409);
  assert.equal(repeated.body.error.code, "REFERRAL_STATE_CONFLICT");

  const { prisma } = await import("../src/database/prisma");
  const referral = await prisma.referral.findUnique({ where: { id: referralId } });
  assert.equal(referral?.status, ReferralStatus.ORDERED);
});

test("referral fulfills through the existing delivered order lifecycle and rejects invalid transitions", async () => {
  const { prisma } = await import("../src/database/prisma");
  await prisma.delivery.create({ data: { orderId, agentId, mode: DeliveryMode.LOCAL, status: DeliveryStatus.OUT_FOR_DELIVERY } });
  await prisma.deliveryProof.create({ data: { deliveryId: (await prisma.delivery.findUniqueOrThrow({ where: { orderId } })).id, uploadedById: agentId, type: DeliveryProofType.DELIVERY_PHOTO, storageKey: `${testKey}/photo`, documentName: "delivery.jpg", mimeType: "image/jpeg", checksum: "checksum" } });

  const delivered = await request("PATCH", `/api/v1/pharmacy/deliveries/${(await prisma.delivery.findUniqueOrThrow({ where: { orderId } })).id}/delivered`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
  const referral = await prisma.referral.findUnique({ where: { id: referralId } });
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(referral?.status, ReferralStatus.FULFILLED);
  assert.equal(order?.status, OrderStatus.DELIVERED);

  const secondDelivery = await request("PATCH", `/api/v1/pharmacy/deliveries/${delivered.body.data.id}/delivered`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  assert.equal(secondDelivery.status, 409);
});

function referralInput() {
  return { patientId, items: [{ productId, quantity: 2 }] };
}

async function createUser(prisma: typeof import("../src/database/prisma").prisma, name: string, role: UserRole) {
  return prisma.user.create({ data: { fullName: `${testKey} ${name}`, email: `${testKey}-${name}@example.com`, phone: `+1555${String(Math.floor(Math.random() * 1_000_0000)).padStart(7, "0")}`, role, isVerified: true } });
}

async function tokenFor(userId: string, role = UserRole.PATIENT) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function request(method: string, path: string, token?: string, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
