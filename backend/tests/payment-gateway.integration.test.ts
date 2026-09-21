import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { OrderStatus, PaymentStatus, UserRole } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config({ override: true });
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME?schema=public";
process.env.JWT_ACCESS_SECRET ??= "gateway-integration-access-secret";
process.env.JWT_REFRESH_SECRET ??= "gateway-integration-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.JWT_REFRESH_EXPIRES_IN ??= "7d";
// The webhook secret must be configured before config/env.ts loads.
process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET = "test-webhook-secret-SECRET-abcdef123456";
delete process.env.PAYMENT_GATEWAY_ENABLED;

const WEBHOOK_SECRET = process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET;

let server: Server;
let baseUrl: string;
let categoryId: string;
let productId: string;
let patientId: string;
let otherPatientId: string;
const orderIds: string[] = [];
const cartIds: string[] = [];
const pincodeIds: string[] = [];
const testKey = `phase35-${Date.now()}`;

type GatewayModule = typeof import("../src/payments/payment-gateway");
let gatewayModule: GatewayModule;
let mock: import("../src/payments/payment-gateway").MockPaymentGateway;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");

  gatewayModule = await import("../src/payments/payment-gateway");
  mock = new gatewayModule.MockPaymentGateway();
  gatewayModule.setPaymentGatewayState({ enabled: true, gateway: mock });

  const category = await prisma.productCategory.create({
    data: { name: `${testKey} Category`, slug: `${testKey}-category` }
  });
  categoryId = category.id;
  const product = await prisma.product.create({
    data: { sku: `${testKey}-P`, name: `yy-${testKey} Product`, categoryId, price: "10.10", currency: "INR" }
  });
  productId = product.id;
  const users = await Promise.all([
    createUser(prisma, "patient", UserRole.PATIENT),
    createUser(prisma, "other-patient", UserRole.PATIENT)
  ]);
  [patientId, otherPatientId] = users.map((user) => user.id);

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
  gatewayModule.resetPaymentGatewayState();
  const { prisma } = await import("../src/database/prisma");
  await prisma.payment.deleteMany({ where: { order: { patientId: { in: [patientId, otherPatientId] } } } });
  await prisma.order.deleteMany({ where: { patientId: { in: [patientId, otherPatientId] } } });
  await prisma.cart.deleteMany({ where: { patientId: { in: [patientId, otherPatientId] } } });
  await prisma.deliveryPincode.deleteMany({ where: { id: { in: pincodeIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [patientId, otherPatientId] } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.productCategory.delete({ where: { id: categoryId } });
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("gateway-enabled initiation returns safe public checkout data with the server amount", async () => {
  const orderId = await createOrder();
  const response = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, await tokenFor(patientId), { method: "PREPAID" });

  assert.equal(response.status, 201);
  assert.equal(response.body.data.provider, "mock");
  assert.equal(response.body.data.status, PaymentStatus.PENDING);
  const checkout = response.body.data.checkout;
  assert.ok(checkout, "checkout payload must be present when the gateway is enabled");
  assert.equal(checkout.provider, "mock");
  assert.equal(checkout.keyId, "mock_public_key_id"); // public id only; no secret fields exist in the response
  assert.equal(checkout.amountMinor, 1010); // 10.10 server-side total in paise
  assert.equal(checkout.currency, "INR");
  assert.equal(checkout.orderId, orderId);
  assert.ok(checkout.gatewayOrderId);
  assert.equal(JSON.stringify(response.body).includes("SECRET"), false);

  const { prisma } = await import("../src/database/prisma");
  const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
  assert.equal(payment.providerOrderId, checkout.gatewayOrderId);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(order.status, OrderStatus.PENDING_PAYMENT); // initiation never transitions the order

  // Idempotent repeat initiation reuses the same gateway order.
  const repeat = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, await tokenFor(patientId), { method: "PREPAID" });
  assert.equal(repeat.status, 201);
  assert.equal(repeat.body.data.checkout.gatewayOrderId, checkout.gatewayOrderId);
  assert.equal(mock.createdOrders.length, 1);
  orderIds.push(orderId);
  globalThis.__gatewayOrderId = checkout.gatewayOrderId as string;
});

test("client-supplied amounts are rejected; the gateway order carries the server amount", async () => {
  const orderId = await createOrder();
  const tampered = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, await tokenFor(patientId), {
    method: "PREPAID",
    amount: "0.01"
  });
  assert.equal(tampered.status, 400);
  assert.equal(tampered.body.error.code, "VALIDATION_ERROR");

  const initiated = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, await tokenFor(patientId), { method: "PREPAID" });
  assert.equal(initiated.status, 201);
  assert.equal(mock.createdOrders[mock.createdOrders.length - 1].amountMinor, 1010);
  orderIds.push(orderId);
});

test("foreign patients cannot initiate or verify another patient's payment", async () => {
  const orderId = await createOrder();
  const initiate = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, await tokenFor(otherPatientId), { method: "PREPAID" });
  assert.equal(initiate.status, 404);

  const verify = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment/verify`, await tokenFor(otherPatientId), {
    gatewayOrderId: "mock_order_x",
    gatewayPaymentId: "mock_pay_x",
    gatewaySignature: "x"
  });
  assert.equal(verify.status, 404);
  orderIds.push(orderId);
});

test("successful verification marks payment and order paid and is idempotent", async () => {
  const orderId = await createOrder();
  const initiate = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, await tokenFor(patientId), { method: "PREPAID" });
  const checkout = initiatedCheckout(initiate);
  const gatewayPaymentId = mock.simulateSuccessfulPayment(checkout.gatewayOrderId);
  const signature = mock.signatureFor(checkout.gatewayOrderId, gatewayPaymentId);

  const verify = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment/verify`, await tokenFor(patientId), {
    gatewayOrderId: checkout.gatewayOrderId,
    gatewayPaymentId,
    gatewaySignature: signature
  });
  assert.equal(verify.status, 200);
  assert.equal(verify.body.data.status, PaymentStatus.PAID);
  assert.equal(verify.body.data.providerPaymentId, gatewayPaymentId);
  assert.ok(verify.body.data.paidAt);

  const { prisma } = await import("../src/database/prisma");
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(order.status, OrderStatus.PAID);

  const repeat = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment/verify`, await tokenFor(patientId), {
    gatewayOrderId: checkout.gatewayOrderId,
    gatewayPaymentId,
    gatewaySignature: signature
  });
  assert.equal(repeat.status, 200); // idempotent
  assert.equal(repeat.body.data.status, PaymentStatus.PAID);
  orderIds.push(orderId);
});

test("invalid or missing signatures are rejected and nothing transitions", async () => {
  const orderId = await createOrder();
  const initiate = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, await tokenFor(patientId), { method: "PREPAID" });
  const checkout = initiatedCheckout(initiate);
  const gatewayPaymentId = mock.simulateSuccessfulPayment(checkout.gatewayOrderId);

  const forged = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment/verify`, await tokenFor(patientId), {
    gatewayOrderId: checkout.gatewayOrderId,
    gatewayPaymentId,
    gatewaySignature: "forged-signature"
  });
  assert.equal(forged.status, 400, JSON.stringify(forged.body));
  assert.equal(forged.body.error.code, "PAYMENT_SIGNATURE_INVALID");

  const missing = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment/verify`, await tokenFor(patientId), {
    gatewayOrderId: checkout.gatewayOrderId,
    gatewayPaymentId
  });
  assert.equal(missing.status, 400, JSON.stringify(missing.body));
  assert.equal(missing.body.error.code, "VALIDATION_ERROR");

  const { prisma } = await import("../src/database/prisma");
  const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
  assert.equal(payment.status, PaymentStatus.PENDING);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(order.status, OrderStatus.PENDING_PAYMENT);
  orderIds.push(orderId);
});

test("gateway order and amount mismatches are rejected safely", async () => {
  const orderId = await createOrder();
  const initiate = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, await tokenFor(patientId), { method: "PREPAID" });
  const checkout = initiatedCheckout(initiate);
  const token = await tokenFor(patientId);

  const otherOrder = await mock.createGatewayOrder({ amountMinor: 9999, currency: "INR", receipt: "other" });
  const orderMismatch = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment/verify`, token, {
    gatewayOrderId: otherOrder.gatewayOrderId,
    gatewayPaymentId: "mock_pay_1",
    gatewaySignature: "x"
  });
  assert.equal(orderMismatch.status, 400);
  assert.equal(orderMismatch.body.error.code, "PAYMENT_ORDER_MISMATCH");

  const wrongAmountId = mock.simulateSuccessfulPayment(checkout.gatewayOrderId, { amountMinor: 999 });
  const amountMismatch = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment/verify`, token, {
    gatewayOrderId: checkout.gatewayOrderId,
    gatewayPaymentId: wrongAmountId,
    gatewaySignature: mock.signatureFor(checkout.gatewayOrderId, wrongAmountId)
  });
  assert.equal(amountMismatch.status, 409);
  assert.equal(amountMismatch.body.error.code, "PAYMENT_AMOUNT_MISMATCH");

  const wrongCurrencyId = mock.simulateSuccessfulPayment(checkout.gatewayOrderId, { currency: "USD" });
  const currencyMismatch = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment/verify`, token, {
    gatewayOrderId: checkout.gatewayOrderId,
    gatewayPaymentId: wrongCurrencyId,
    gatewaySignature: mock.signatureFor(checkout.gatewayOrderId, wrongCurrencyId)
  });
  assert.equal(currencyMismatch.status, 409);
  assert.equal(currencyMismatch.body.error.code, "PAYMENT_CURRENCY_MISMATCH");

  const { prisma } = await import("../src/database/prisma");
  const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
  assert.equal(payment.status, PaymentStatus.PENDING);
  orderIds.push(orderId);
});

test("authorized and failed gateway payments transition without marking the order paid", async () => {
  const authorizedOrderId = await createOrder();
  const authorizedInitiate = await request("POST", `/api/v1/pharmacy/orders/${authorizedOrderId}/payment`, await tokenFor(patientId), { method: "PREPAID" });
  const authorizedCheckout = initiatedCheckout(authorizedInitiate);
  const authorizedId = mock.simulateSuccessfulPayment(authorizedCheckout.gatewayOrderId, { status: "AUTHORIZED" });
  const authorized = await request("POST", `/api/v1/pharmacy/orders/${authorizedOrderId}/payment/verify`, await tokenFor(patientId), {
    gatewayOrderId: authorizedCheckout.gatewayOrderId,
    gatewayPaymentId: authorizedId,
    gatewaySignature: mock.signatureFor(authorizedCheckout.gatewayOrderId, authorizedId)
  });
  assert.equal(authorized.status, 200);
  assert.equal(authorized.body.data.status, PaymentStatus.AUTHORIZED);
  const { prisma } = await import("../src/database/prisma");
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: authorizedOrderId } })).status, OrderStatus.PENDING_PAYMENT);

  const failedOrderId = await createOrder();
  const failedInitiate = await request("POST", `/api/v1/pharmacy/orders/${failedOrderId}/payment`, await tokenFor(patientId), { method: "PREPAID" });
  const failedCheckout = initiatedCheckout(failedInitiate);
  const failedId = mock.simulateSuccessfulPayment(failedCheckout.gatewayOrderId, { status: "FAILED" });
  const failed = await request("POST", `/api/v1/pharmacy/orders/${failedOrderId}/payment/verify`, await tokenFor(patientId), {
    gatewayOrderId: failedCheckout.gatewayOrderId,
    gatewayPaymentId: failedId,
    gatewaySignature: mock.signatureFor(failedCheckout.gatewayOrderId, failedId)
  });
  assert.equal(failed.status, 200);
  assert.equal(failed.body.data.status, PaymentStatus.FAILED);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: failedOrderId } })).status, OrderStatus.PENDING_PAYMENT);
  orderIds.push(authorizedOrderId, failedOrderId);
});

test("COD still works with the gateway enabled and stays out of the gateway flow", async () => {
  const { prisma } = await import("../src/database/prisma");
  const pincode = `${testKey}1`.slice(-10).replace(/[^0-9]/g, "1").padEnd(6, "1").slice(0, 6);
  const created = await prisma.deliveryPincode.create({
    data: { pincode, isActive: true, codEligible: true, localDeliveryEligible: true }
  });
  pincodeIds.push(created.id);

  const orderId = await createOrder(undefined, pincode);
  const response = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, await tokenFor(patientId), { method: "COD" });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.status, PaymentStatus.PENDING);
  assert.equal(response.body.data.provider, "COD");
  assert.equal(response.body.data.checkout, undefined); // no gateway checkout for COD
  orderIds.push(orderId);
});

test("verification without a configured gateway is unavailable and initiation keeps legacy behavior", async () => {
  gatewayModule.resetPaymentGatewayState(); // env leaves the gateway disabled

  const orderId = await createOrder();
  const initiate = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, await tokenFor(patientId), { method: "PREPAID" });
  assert.equal(initiate.status, 201);
  assert.equal(initiate.body.data.provider, "PENDING_PROVIDER_INTEGRATION");
  assert.equal(initiate.body.data.checkout, undefined);

  const verify = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment/verify`, await tokenFor(patientId), {
    gatewayOrderId: "mock_order_x",
    gatewayPaymentId: "mock_pay_x",
    gatewaySignature: "x"
  });
  assert.equal(verify.status, 503);
  assert.equal(verify.body.error.code, "PAYMENT_GATEWAY_DISABLED");

  gatewayModule.setPaymentGatewayState({ enabled: true, gateway: mock }); // restore for webhook tests
  orderIds.push(orderId);
});

test("captured webhooks mark the payment and order paid idempotently", async () => {
  const orderId = await createOrder();
  const initiate = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, await tokenFor(patientId), { method: "PREPAID" });
  const checkout = initiatedCheckout(initiate);
  const gatewayPaymentId = mock.simulateSuccessfulPayment(checkout.gatewayOrderId);
  const payload = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: gatewayPaymentId, order_id: checkout.gatewayOrderId, amount: 1010, currency: "INR" } } }
  });
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");

  const first = await request("POST", "/api/v1/payments/webhook", undefined, raw(payload), { "x-razorpay-signature": signature });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.handled, true);

  const { prisma } = await import("../src/database/prisma");
  const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
  assert.equal(payment.status, PaymentStatus.PAID);
  assert.equal(payment.providerPaymentId, gatewayPaymentId);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status, OrderStatus.PAID);

  // Replay is idempotent: no error, no double processing.
  const replay = await request("POST", "/api/v1/payments/webhook", undefined, raw(payload), { "x-razorpay-signature": signature });
  assert.equal(replay.status, 200);
  const payments = await prisma.payment.count({ where: { orderId } });
  assert.equal(payments, 1);
  const paidAt = payment.paidAt;
  const afterReplay = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
  assert.equal(afterReplay.paidAt?.getTime(), paidAt?.getTime());
  orderIds.push(orderId);
});

test("webhooks with bad signatures, unsupported events, or mismatched amounts are handled safely", async () => {
  const { prisma } = await import("../src/database/prisma");
  const orderId = await createOrder();
  const initiate = await request("POST", `/api/v1/pharmacy/orders/${orderId}/payment`, await tokenFor(patientId), { method: "PREPAID" });
  const checkout = initiatedCheckout(initiate);
  orderIds.push(orderId);

  const capturedPayload = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "mock_pay_evil", order_id: checkout.gatewayOrderId, amount: 1010, currency: "INR" } } }
  });
  const badSignature = await request("POST", "/api/v1/payments/webhook", undefined, raw(capturedPayload), {
    "x-razorpay-signature": createHmac("sha256", "wrong-secret").update(capturedPayload).digest("hex")
  });
  assert.equal(badSignature.status, 400);
  assert.equal(badSignature.body.error.code, "WEBHOOK_SIGNATURE_INVALID");

  const missingSignature = await request("POST", "/api/v1/payments/webhook", undefined, raw(capturedPayload));
  assert.equal(missingSignature.status, 400);

  const unsupportedPayload = JSON.stringify({
    event: "refund.processed",
    payload: { payment: { entity: { id: "mock_pay_1", order_id: checkout.gatewayOrderId, amount: 1010, currency: "INR" } } }
  });
  const unsupported = await request("POST", "/api/v1/payments/webhook", undefined, raw(unsupportedPayload), {
    "x-razorpay-signature": createHmac("sha256", WEBHOOK_SECRET).update(unsupportedPayload).digest("hex")
  });
  assert.equal(unsupported.status, 200);
  assert.equal(unsupported.body.data.handled, false);

  const amountMismatchPayload = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "mock_pay_evil2", order_id: checkout.gatewayOrderId, amount: 999, currency: "INR" } } }
  });
  const amountMismatch = await request("POST", "/api/v1/payments/webhook", undefined, raw(amountMismatchPayload), {
    "x-razorpay-signature": createHmac("sha256", WEBHOOK_SECRET).update(amountMismatchPayload).digest("hex")
  });
  assert.equal(amountMismatch.status, 200);
  assert.equal(amountMismatch.body.data.handled, false);

  const unknownOrderPayload = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "mock_pay_x", order_id: "order_unknown", amount: 1010, currency: "INR" } } }
  });
  const unknownOrder = await request("POST", "/api/v1/payments/webhook", undefined, raw(unknownOrderPayload), {
    "x-razorpay-signature": createHmac("sha256", WEBHOOK_SECRET).update(unknownOrderPayload).digest("hex")
  });
  assert.equal(unknownOrder.status, 200);
  assert.equal(unknownOrder.body.data.handled, false);

  const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
  assert.equal(payment.status, PaymentStatus.PENDING); // nothing above transitioned it
});

function initiatedCheckout(response: { status: number; body: any }): { gatewayOrderId: string } {
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const checkout = response.body.data.checkout;
  assert.ok(checkout, "expected a gateway checkout payload");
  return checkout as { gatewayOrderId: string };
}

function raw(body: string): string {
  return body;
}

async function createUser(prisma: typeof import("../src/database/prisma").prisma, name: string, role: UserRole) {
  return prisma.user.create({ data: { fullName: `${testKey} ${name}`, email: `${testKey}-${name}@example.com`, phone: `+1555${String(Math.floor(Math.random() * 1_000_0000)).padStart(7, "0")}`, role, isVerified: true } });
}

async function tokenFor(userId: string, role = UserRole.PATIENT) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function createOrder(firstProductId = productId, deliveryPincode?: string) {
  const { prisma } = await import("../src/database/prisma");
  const cart = await prisma.cart.create({ data: { patientId, currency: "INR" } });
  cartIds.push(cart.id);
  const product = await prisma.product.findUniqueOrThrow({ where: { id: firstProductId } });
  await prisma.cartItem.create({ data: { cartId: cart.id, productId: product.id, quantity: 1, unitPriceSnapshot: product.price, productNameSnapshot: product.name } });
  const response = await request("POST", "/api/v1/pharmacy/orders", await tokenFor(patientId), deliveryPincode ? { deliveryPincode } : {});
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id as string;
}

async function request(method: string, path: string, token?: string, body?: unknown, headers?: Record<string, string>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((body !== undefined && typeof body !== "string") || headers ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {})
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
  });
  return { status: response.status, body: (await response.json()) as any };
}
