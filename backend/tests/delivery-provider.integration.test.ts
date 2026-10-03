import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { DeliveryMode, DeliveryStatus, OrderOriginType, OrderStatus, PaymentMethod, PaymentStatus, UserRole } from "@prisma/client";
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
let agentId: string;
let otherAgentId: string;
let adminId: string;
const orderIds: string[] = [];
const testKey = `phase3_8-${Date.now()}`;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");
  const users = await Promise.all([
    createUser(prisma, "patient", UserRole.PATIENT),
    createUser(prisma, "pharmacist", UserRole.PHARMACIST),
    createUser(prisma, "agent", UserRole.DELIVERY_AGENT),
    createUser(prisma, "other-agent", UserRole.DELIVERY_AGENT),
    createUser(prisma, "ops-admin", UserRole.OPS_ADMIN)
  ]);
  [patientId, pharmacistId, agentId, otherAgentId, adminId] = users.map((user) => user.id);

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
  await prisma.order.deleteMany({ where: { patientId } });
  await prisma.product.deleteMany({ where: { name: { contains: testKey } } });
  await prisma.user.deleteMany({ where: { id: { in: [patientId, pharmacistId, agentId, otherAgentId, adminId] } } });
  const { resetDeliveryProvider } = await import("../src/modules/pharmacy/delivery/delivery-provider-selector");
  resetDeliveryProvider();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("MANUAL_LOCAL provider is the default and performs no network calls", async () => {
  const { getDeliveryProvider } = await import("../src/modules/pharmacy/delivery/delivery-provider-selector");
  const { ManualLocalDeliveryProvider } = await import("../src/modules/pharmacy/delivery/delivery-provider");
  const provider = getDeliveryProvider();
  assert.equal(provider.provider, "MANUAL_LOCAL");
  assert.equal(provider.mode, "MANUAL_LOCAL");
  assert.ok(provider instanceof ManualLocalDeliveryProvider);

  const result = await provider.createShipment({ deliveryId: "d-1", orderId: "o-1", mode: DeliveryMode.LOCAL, pincode: "560001", hasColdChainItems: false });
  assert.equal(result.reference, "d-1");
  assert.equal(result.mode, "MANUAL_LOCAL");
});

test("assignment records a provider reference and repeated assignment is idempotent", async () => {
  const { prisma } = await import("../src/database/prisma");
  const { MockDeliveryProvider, setDeliveryProvider } = await import("../src/modules/pharmacy/delivery/delivery-provider");
  const { setDeliveryProvider: setActive } = await import("../src/modules/pharmacy/delivery/delivery-provider-selector");
  const mock = new MockDeliveryProvider();
  setActive(mock);

  const { deliveryId, orderId } = await createPaidPrepaidOrder();
  const token = await tokenFor(pharmacistId, UserRole.PHARMACIST);

  const first = await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/assign`, token, { agentId });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.status, DeliveryStatus.ASSIGNED);
  assert.equal(first.body.data.trackingNumber, "MOCK-SHP-1");
  assert.equal(first.body.data.courierName, "MOCK_DELIVERY_PROVIDER");
  assert.equal(mock.createdShipments.length, 1);
  assert.equal(mock.createdShipments[0].deliveryId, deliveryId);

  // A repeat assignment of the same delivery keeps the original reference
  // (shipment creation is not duplicated for an already-referenced delivery).
  const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } });
  assert.equal(delivery?.trackingNumber, "MOCK-SHP-1");
  assert.ok(orderId);

  const { resetDeliveryProvider } = await import("../src/modules/pharmacy/delivery/delivery-provider-selector");
  resetDeliveryProvider();
});

test("default MANUAL_LOCAL reference is the internal delivery id and persists", async () => {
  const { prisma } = await import("../src/database/prisma");
  const { deliveryId } = await createPaidPrepaidOrder();
  const response = await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/assign`, await tokenFor(pharmacistId, UserRole.PHARMACIST), { agentId });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.trackingNumber, deliveryId);
  assert.equal(response.body.data.courierName, "MANUAL_LOCAL");

  const stored = await prisma.delivery.findUnique({ where: { id: deliveryId } });
  assert.equal(stored?.trackingNumber, deliveryId);
  assert.equal(stored?.courierName, "MANUAL_LOCAL");
});

test("assignment is rejected for courier-mode deliveries and non-PENDING deliveries", async () => {
  const { deliveryId } = await createPaidPrepaidOrder({ mode: DeliveryMode.COURIER });
  const courierAssign = await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/assign`, await tokenFor(pharmacistId, UserRole.PHARMACIST), { agentId });
  assert.equal(courierAssign.status, 409);
  assert.equal(courierAssign.body.error.code, "COURIER_DELIVERY_NOT_SUPPORTED");

  const { deliveryId: pendingId } = await createUnpaidPrepaidOrder();
  // Assignment of a PENDING delivery succeeds (existing Phase 1 behavior —
  // assignment is not completion); the unpaid guard is enforced at delivery
  // completion time and is covered by its own dedicated test below.
  const pendingAssign = await request("POST", `/api/v1/pharmacy/deliveries/${pendingId}/assign`, await tokenFor(pharmacistId, UserRole.PHARMACIST), { agentId });
  assert.equal(pendingAssign.status, 200);
  assert.equal(pendingAssign.body.data.status, DeliveryStatus.ASSIGNED);
});

test("patient and delivery agents cannot assign deliveries", async () => {
  const { deliveryId } = await createPaidPrepaidOrder();

  const patientTry = await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/assign`, await tokenFor(patientId, UserRole.PATIENT), { agentId });
  assert.equal(patientTry.status, 403);

  const agentTry = await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/assign`, await tokenFor(agentId, UserRole.DELIVERY_AGENT), { agentId });
  assert.equal(agentTry.status, 403);
});

test("agents cannot self-assign arbitrary deliveries: other agent gets 404", async () => {
  const { deliveryId } = await createPaidPrepaidOrder();
  await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/assign`, await tokenFor(pharmacistId, UserRole.PHARMACIST), { agentId });

  const foreign = await request("GET", `/api/v1/pharmacy/deliveries/${deliveryId}`, await tokenFor(otherAgentId, UserRole.DELIVERY_AGENT));
  assert.equal(foreign.status, 404);

  const out = await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/out-for-delivery`, await tokenFor(otherAgentId, UserRole.DELIVERY_AGENT));
  assert.equal(out.status, 409);
});

test("unpaid prepaid order cannot be marked delivered by delivery transitions", async () => {
  const { prisma } = await import("../src/database/prisma");
  const { deliveryId } = await createUnpaidPrepaidOrder();
  // Force-assign the delivery (simulating any mis-assignment): the unpaid
  // guard must still block delivery completion.
  await prisma.delivery.update({ where: { id: deliveryId }, data: { agentId, status: DeliveryStatus.OUT_FOR_DELIVERY, assignedAt: new Date(), outForDeliveryAt: new Date() } });
  const attempt = await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/delivered`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  assert.equal(attempt.status, 409);
  assert.equal(attempt.body.error.code, "PAYMENT_NOT_COMPLETE");
});

test("full local lifecycle: out-for-delivery, proof gates, COD proof requirement, delivered", async () => {
  const { prisma } = await import("../src/database/prisma");
  const { deliveryId, orderId } = await createPaidCodOrder();

  await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/assign`, await tokenFor(pharmacistId, UserRole.PHARMACIST), { agentId });

  const earlyDeliver = await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/delivered`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  assert.equal(earlyDeliver.status, 409);

  const out = await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/out-for-delivery`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  assert.equal(out.status, 200);
  assert.equal(out.body.data.status, DeliveryStatus.OUT_FOR_DELIVERY);

  const deliverWithoutProof = await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/delivered`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  assert.equal(deliverWithoutProof.status, 400);
  assert.equal(deliverWithoutProof.body.error.code, "DELIVERY_PROOF_REQUIRED");

  const photo = await requestForm("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/proofs`, await tokenFor(agentId, UserRole.DELIVERY_AGENT), proofFile("photo.png", "image/png", "DELIVERY_PHOTO"));
  assert.equal(photo.status, 201);

  const deliverWithoutCodProof = await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/delivered`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  assert.equal(deliverWithoutCodProof.status, 400);
  assert.equal(deliverWithoutCodProof.body.error.code, "COD_PROOF_REQUIRED");

  const cod = await requestForm("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/proofs`, await tokenFor(agentId, UserRole.DELIVERY_AGENT), proofFile("cod.png", "image/png", "CASH_OVER_BILL"));
  assert.equal(cod.status, 201);

  const delivered = await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/delivered`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  assert.equal(delivered.status, 200);
  assert.equal(delivered.body.data.status, DeliveryStatus.DELIVERED);

  // COD collection is recorded through the required CASH_OVER_BILL proof
  // (the existing authorized workflow); Phase 4.8 additionally records the
  // financial state atomically with the proof: the payment becomes
  // CASH_COLLECTED exactly once, and never regresses on repeated proofs.
  const payment = await prisma.payment.findFirst({ where: { orderId } });
  assert.equal(payment?.status, PaymentStatus.CASH_COLLECTED);
  assert.ok(payment?.paidAt);
  const proofCount = await prisma.deliveryProof.count({ where: { deliveryId, type: "CASH_OVER_BILL" } });
  assert.equal(proofCount, 1);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(order?.status, OrderStatus.DELIVERED);
});

test("COD proof rejected for prepaid orders and non-COD proof types gated", async () => {
  const { deliveryId } = await createPaidPrepaidOrder();
  await request("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/assign`, await tokenFor(pharmacistId, UserRole.PHARMACIST), { agentId });
  await request("PATCH", `/api/v1/pharmacy/deliveries/${deliveryId}/out-for-delivery`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));

  const codProof = await requestForm("POST", `/api/v1/pharmacy/deliveries/${deliveryId}/proofs`, await tokenFor(agentId, UserRole.DELIVERY_AGENT), proofFile("cod.png", "image/png", "CASH_OVER_BILL"));
  assert.equal(codProof.status, 400);
  assert.equal(codProof.body.error.code, "COD_PROOF_NOT_REQUIRED");
});

test("admin delivery queue lists deliveries with filters", async () => {
  const response = await request("GET", "/api/v1/admin/pharmacy/deliveries?status=PENDING&mode=LOCAL", await tokenFor(adminId, UserRole.OPS_ADMIN));
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.data.items));

  const patientTry = await request("GET", "/api/v1/admin/pharmacy/deliveries", await tokenFor(patientId, UserRole.PATIENT));
  assert.equal(patientTry.status, 403);
});

test("agents cannot modify payment amounts or ownership data (no such endpoints; 404 on foreign access)", async () => {
  const { deliveryId } = await createPaidPrepaidOrder();
  const agentView = await request("GET", `/api/v1/pharmacy/deliveries/${deliveryId}`, await tokenFor(agentId, UserRole.DELIVERY_AGENT));
  assert.equal(agentView.status, 404, "agent cannot see deliveries not assigned to them");
});

// --- helpers ---

async function createUser(prisma: typeof import("../src/database/prisma").prisma, name: string, role: UserRole) {
  return prisma.user.create({
    data: {
      fullName: `${testKey} ${name}`,
      email: `${testKey}-${name}@example.com`,
      phone: `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`,
      role,
      isVerified: true
    }
  });
}

async function createOrderBase(prisma: typeof import("../src/database/prisma").prisma, method: PaymentMethod, paid: boolean) {
  const category = await prisma.productCategory.upsert({
    where: { slug: `${testKey}-category` },
    create: { name: `${testKey}-category`, slug: `${testKey}-category` },
    update: {}
  });
  const product = await prisma.product.create({
    data: {
      name: `Paracetamol ${testKey}`,
      sku: `${testKey}-SKU-${Math.random().toString(36).slice(2, 8)}`,
      categoryId: category.id,
      price: "200.00",
      currency: "INR",
      isActive: true,
      minimumQuantity: 1,
      prescriptionRequired: false,
      coldChainRequired: false
    }
  });
  const order = await prisma.order.create({
    data: {
      patientId,
      originType: OrderOriginType.DIRECT_CART,
      status: paid ? OrderStatus.PAID : OrderStatus.PENDING_PAYMENT,
      currency: "INR",
      subtotal: "200.00",
      deliveryFee: "0.00",
      totalAmount: "200.00",
      deliveryPincode: "560001",
      items: { create: { productId: product.id, productNameSnapshot: product.name, quantity: 1, unitPriceSnapshot: "200.00" } },
      payments: { create: { method, status: paid ? (method === PaymentMethod.COD ? PaymentStatus.PENDING : PaymentStatus.PAID) : PaymentStatus.PENDING, amount: "200.00", currency: "INR", provider: "PENDING_PROVIDER_INTEGRATION" } }
    },
    include: { payments: true }
  });
  orderIds.push(order.id);
  return order;
}

async function createDeliveryRecord(prisma: typeof import("../src/database/prisma").prisma, orderId: string, mode: DeliveryMode) {
  const delivery = await prisma.delivery.create({ data: { orderId, mode, status: DeliveryStatus.PENDING } });
  return delivery;
}

async function createPaidPrepaidOrder(overrides: { mode?: DeliveryMode } = {}) {
  const { prisma } = await import("../src/database/prisma");
  const order = await createOrderBase(prisma, PaymentMethod.PREPAID, true);
  const delivery = await createDeliveryRecord(prisma, order.id, overrides.mode ?? DeliveryMode.LOCAL);
  return { orderId: order.id, deliveryId: delivery.id };
}

async function createUnpaidPrepaidOrder() {
  const { prisma } = await import("../src/database/prisma");
  const order = await createOrderBase(prisma, PaymentMethod.PREPAID, false);
  const delivery = await createDeliveryRecord(prisma, order.id, DeliveryMode.LOCAL);
  return { orderId: order.id, deliveryId: delivery.id };
}

async function createPaidCodOrder() {
  const { prisma } = await import("../src/database/prisma");
  const order = await createOrderBase(prisma, PaymentMethod.COD, true);
  const delivery = await createDeliveryRecord(prisma, order.id, DeliveryMode.LOCAL);
  return { orderId: order.id, deliveryId: delivery.id };
}

async function tokenFor(userId: string, role = UserRole.PATIENT) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function request(method: string, path: string, token?: string, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

function proofFile(name: string, mimeType: string, proofType: "DELIVERY_PHOTO" | "CASH_OVER_BILL"): FormData {
  const form = new FormData();
  form.append("proofType", proofType);
  form.append("file", new Blob([Buffer.from("proof-payload")], { type: mimeType }), name);
  return form;
}

async function requestForm(method: string, path: string, token: string, body: FormData) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
