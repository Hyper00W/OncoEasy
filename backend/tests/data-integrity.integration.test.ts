import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import {
  DeliveryMode,
  DeliveryProofType,
  DeliveryStatus,
  LabBookingStatus,
  OrderStatus,
  PapApplicationStatus,
  PaymentMethod,
  PaymentStatus,
  UserRole
} from "@prisma/client";
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
let adminId: string;
let agentId: string;
const testKey = `phase148-${Date.now()}`;
const createdUserIds: string[] = [];
const createdProgramIds: string[] = [];
const createdProductIds: string[] = [];
let codDeliveryId = "";
let papApplicationId = "";
let labBookingId = "";

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");
  const users = await Promise.all([
    createUser(prisma, "patient", UserRole.PATIENT),
    createUser(prisma, "pharmacist", UserRole.PHARMACIST),
    createUser(prisma, "admin", UserRole.OPS_ADMIN),
    createUser(prisma, "agent", UserRole.DELIVERY_AGENT)
  ]);
  [patientId, pharmacistId, adminId, agentId] = users.map((user) => user.id);
  createdUserIds.push(...users.map((user) => user.id));

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
  await prisma.delivery.deleteMany({ where: { order: { patientId } } });
  await prisma.payment.deleteMany({ where: { order: { patientId } } });
  await prisma.order.deleteMany({ where: { patientId } });
  await prisma.pAPApplicationDocument.deleteMany({ where: { applicationId: papApplicationId } });
  await prisma.pAPApplication.deleteMany({ where: { id: papApplicationId } });
  await prisma.labBooking.deleteMany({ where: { id: labBookingId } });
  await prisma.pAPProgram.deleteMany({ where: { id: { in: createdProgramIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.productCategory.deleteMany({ where: { name: { startsWith: testKey } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("concurrent COD proof uploads do not double-collect the cash payment", async () => {
  const { prisma } = await import("../src/database/prisma");
  const { orderId, deliveryId } = await createOrderWithDelivery(prisma, { cod: true, status: OrderStatus.PROCESSING });
  codDeliveryId = deliveryId;
  await assignDelivery(deliveryId);
  await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/out-for-delivery`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));

  // Two agents' worth of concurrent COD proof uploads: collection must apply
  // exactly once (conditional on PENDING), and both proofs must persist.
  const [first, second] = await Promise.all([
    request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/proofs`, await tokenFor(agentId, UserRole.DELIVERY_AGENT), codProofForm("CASH_OVER_BILL")),
    request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/proofs`, await tokenFor(agentId, UserRole.DELIVERY_AGENT), codProofForm("ONLINE_PAYMENT"))
  ]);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
  assert.equal(payment.status, PaymentStatus.CASH_COLLECTED);
  assert.ok(payment.paidAt);

  // Idempotent: an additional COD proof does not regress or duplicate state.
  const third = await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/proofs`, await tokenFor(agentId, UserRole.DELIVERY_AGENT), codProofForm("CASH_OVER_BILL"));
  assert.equal(third.status, 201);
  const refreshed = await prisma.payment.findFirstOrThrow({ where: { orderId } });
  assert.equal(refreshed.status, PaymentStatus.CASH_COLLECTED);
  const codPayments = await prisma.payment.count({ where: { orderId, method: PaymentMethod.COD } });
  assert.equal(codPayments, 1);
});

test("marking delivered moves the order to DELIVERED only from a valid fulfillment state", async () => {
  const { prisma } = await import("../src/database/prisma");
  const { orderId, deliveryId } = await createOrderWithDelivery(prisma, { cod: true, status: OrderStatus.READY_FOR_DELIVERY });
  await assignDelivery(deliveryId);
  await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/out-for-delivery`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/proofs`, await tokenFor(agentId, UserRole.DELIVERY_AGENT), codProofForm("DELIVERY_PHOTO"));
  await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/proofs`, await tokenFor(agentId, UserRole.DELIVERY_AGENT), codProofForm("CASH_OVER_BILL"));

  const delivered = await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/delivered`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  assert.equal(delivered.status, 200);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(order.status, OrderStatus.DELIVERED);

  // A completed delivery cannot re-complete, and the order cannot regress.
  const repeat = await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/delivered`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  assert.equal(repeat.status, 409);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status, OrderStatus.DELIVERED);
});

test("a cancelled order can never be flipped to DELIVERED by delivery completion", async () => {
  const { prisma } = await import("../src/database/prisma");
  const { orderId, deliveryId } = await createOrderWithDelivery(prisma, { cod: true, status: OrderStatus.OUT_FOR_DELIVERY });
  await assignDelivery(deliveryId);
  await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/out-for-delivery`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/proofs`, await tokenFor(agentId, UserRole.DELIVERY_AGENT), codProofForm("DELIVERY_PHOTO"));
  await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/proofs`, await tokenFor(agentId, UserRole.DELIVERY_AGENT), codProofForm("CASH_OVER_BILL"));

  // Simulate an Ops cancellation of the underlying order after dispatch.
  await prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.CANCELLED } });

  const delivered = await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/delivered`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  assert.equal(delivered.status, 409);
  assert.equal(delivered.body.error.code, "ORDER_STATE_CONFLICT");
  const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(finalOrder.status, OrderStatus.CANCELLED);

  // The delivery itself is rolled back with the order guard inside the same
  // transaction, so it must NOT be stuck in DELIVERED.
  const finalDelivery = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
  assert.equal(finalDelivery.status, DeliveryStatus.OUT_FOR_DELIVERY);
}, { timeout: 20000 });

test("double-assigning a delivery keeps the first agent and rejects the loser", async () => {
  const { prisma } = await import("../src/database/prisma");
  const { deliveryId } = await createOrderWithDelivery(prisma, { cod: false, status: OrderStatus.PAID, prepaid: true });

  // Second active agent for the racing assignment.
  const secondAgent = await createUser(prisma, "agent-2", UserRole.DELIVERY_AGENT);
  createdUserIds.push(secondAgent.id);

  const [first, second] = await Promise.all([
    request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/assign`, await tokenFor(pharmacistId, UserRole.PHARMACIST), { agentId }),
    request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/assign`, await tokenFor(pharmacistId, UserRole.PHARMACIST), { agentId: secondAgent.id })
  ]);

  const winner = [first, second].find((response) => response.status === 200);
  const loser = [first, second].find((response) => response.status === 409);
  assert.ok(winner, "exactly one assignment should succeed");
  assert.ok(loser, "the losing assignment should get a 409 conflict");
  const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { order: true } });
  assert.equal(delivery.status, DeliveryStatus.ASSIGNED);
  assert.ok([agentId, secondAgent.id].includes(delivery.agentId ?? ""));
  assert.equal(delivery.order.status, OrderStatus.PAID, "assignment must not change payment/order state");
});

test("unpaid prepaid order can never be marked delivered", async () => {
  const { prisma } = await import("../src/database/prisma");
  const { orderId, deliveryId } = await createOrderWithDelivery(prisma, { cod: false, status: OrderStatus.PROCESSING, prepaid: true, prepaidPending: true });
  await assignDelivery(deliveryId);
  await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/out-for-delivery`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/proofs`, await tokenFor(agentId, UserRole.DELIVERY_AGENT), codProofForm("DELIVERY_PHOTO"));

  const attempt = await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/delivered`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  assert.equal(attempt.status, 409);
  assert.equal(attempt.body.error.code, "PAYMENT_NOT_COMPLETE");
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  assert.notEqual(order.status, OrderStatus.DELIVERED);
});

test("concurrent PAP reviewers cannot interleave contradictory statuses", async () => {
  const { prisma } = await import("../src/database/prisma");
  const program = await prisma.pAPProgram.create({ data: { name: `${testKey} Race Program`, description: "d", eligibilityDescription: "e", requiredDocuments: [], isActive: true } });
  createdProgramIds.push(program.id);
  const application = await prisma.pAPApplication.create({
    data: { patientId, papProgramId: program.id, applicationData: {} as object, status: PapApplicationStatus.UNDER_REVIEW }
  });
  papApplicationId = application.id;

  const adminToken = await tokenFor(adminId, UserRole.OPS_ADMIN);
  const [approve, reject] = await Promise.all([
    request("PATCH", `/api/v1/admin/pap/applications/${application.id}/status`, adminToken, { status: PapApplicationStatus.APPROVED, reason: "ok" }),
    request("PATCH", `/api/v1/admin/pap/applications/${application.id}/status`, adminToken, { status: PapApplicationStatus.REJECTED, reason: "no" })
  ]);

  const statuses = [approve.status, reject.status].sort();
  assert.deepEqual(statuses, [200, 409], "exactly one reviewer transition should win");
  const refreshed = await prisma.pAPApplication.findUniqueOrThrow({ where: { id: application.id } });
  assert.ok([PapApplicationStatus.APPROVED, PapApplicationStatus.REJECTED].includes(refreshed.status));
});

test("lab booking status transitions are atomic under concurrent updates", async () => {
  const { prisma } = await import("../src/database/prisma");
  const booking = await prisma.labBooking.create({
    data: { patientId, labTestId: (await createLabTest(prisma)).id, collectionType: "HOME", preferredDate: new Date(Date.now() + 86_400_000), status: LabBookingStatus.SAMPLE_COLLECTED }
  });
  labBookingId = booking.id;

  const adminToken = await tokenFor(adminId, UserRole.OPS_ADMIN);
  const [toReport, toCancel] = await Promise.all([
    request("PATCH", `/api/v1/admin/labs/bookings/${booking.id}/status`, adminToken, { status: LabBookingStatus.REPORT_READY }),
    request("PATCH", `/api/v1/admin/labs/bookings/${booking.id}/status`, adminToken, { status: LabBookingStatus.CANCELLED })
  ]);

  const codes = [toReport.status, toCancel.status].sort();
  assert.deepEqual(codes, [200, 409], "only one concurrent transition may win");
  const refreshed = await prisma.labBooking.findUniqueOrThrow({ where: { id: booking.id } });
  assert.ok([LabBookingStatus.REPORT_READY, LabBookingStatus.CANCELLED].includes(refreshed.status));
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function createUser(prisma: typeof import("../src/database/prisma").prisma, name: string, role: UserRole) {
  const user = await prisma.user.create({
    data: { fullName: `${testKey} ${name}`, email: `${testKey}-${name}-${Math.random()}@example.com`, phone: `+1555${String(Math.floor(Math.random() * 1_000_0000)).padStart(7, "0")}`, role, isVerified: true }
  });
  return user;
}

async function createCategoryAndProduct(prisma: typeof import("../src/database/prisma").prisma) {
  const category = await prisma.productCategory.create({ data: { name: `${testKey}-${Math.random()}`, slug: `${testKey}-${Math.random()}` } });
  const product = await prisma.product.create({ data: { sku: `${testKey}-${Math.random()}`, name: "Integrity item", categoryId: category.id, price: "50.00", currency: "INR" } });
  createdProductIds.push(product.id);
  return product;
}

async function createOrderWithDelivery(
  prisma: typeof import("../src/database/prisma").prisma,
  options: { cod: boolean; status: OrderStatus; prepaid?: boolean; prepaidPending?: boolean }
) {
  const product = await createCategoryAndProduct(prisma);
  const order = await prisma.order.create({
    data: {
      patientId,
      originType: "DIRECT_CART",
      status: options.status,
      currency: "INR",
      subtotal: "50.00",
      deliveryFee: "0.00",
      totalAmount: "50.00",
      deliveryPincode: "560001",
      items: { create: [{ productId: product.id, quantity: 1, unitPriceSnapshot: "50.00", productNameSnapshot: product.name }] },
      payments: options.cod
        ? { create: { method: PaymentMethod.COD, status: PaymentStatus.PENDING, amount: "50.00", currency: "INR", provider: "COD" } }
        : options.prepaid
          ? { create: { method: PaymentMethod.PREPAID, status: options.prepaidPending ? PaymentStatus.PENDING : PaymentStatus.PAID, amount: "50.00", currency: "INR", provider: "MANUAL_LOCAL" } }
          : undefined
    }
  });
  const delivery = await prisma.delivery.create({ data: { orderId: order.id, mode: DeliveryMode.LOCAL } });
  return { orderId: order.id, deliveryId: delivery.id };
}

async function createLabTest(prisma: typeof import("../src/database/prisma").prisma) {
  return prisma.labTest.create({
    data: { name: `${testKey} Panel`, description: "integrity", category: "BLOOD", price: "199.00", currency: "INR", requiresPrescription: false, homeCollectionAvailable: true, centerCollectionAvailable: true, isActive: true }
  });
}

async function assignDelivery(deliveryId: string) {
  const response = await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/assign`, await tokenFor(pharmacistId, UserRole.PHARMACIST), { agentId });
  assert.equal(response.status, 200);
}

function codProofForm(proofType: string) {
  const form = new FormData();
  form.append("proofType", proofType);
  form.append("file", new Blob([Buffer.from(`proof-${proofType}-${Math.random()}`)], { type: "image/png" }), `${proofType.toLowerCase()}.png`);
  return form;
}

async function tokenFor(userId: string, role = UserRole.PATIENT) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function request(method: string, path: string, token?: string, body?: BodyInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}`, ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) } : undefined,
    body: body instanceof FormData || body === undefined ? body : JSON.stringify(body ?? undefined)
  });
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed as any };
}
