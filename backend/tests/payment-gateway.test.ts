import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { AppError } from "../src/errors/app-error";

// Environment must be settled before the config/payments modules load.
// PORT is pinned because the ambient shell may export an invalid value.
process.env.PORT = "3000";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME?schema=public";
process.env.JWT_ACCESS_SECRET ??= "gateway-test-access-secret-0123456789abcdef";
process.env.JWT_REFRESH_SECRET ??= "gateway-test-refresh-secret-0123456789abcdef";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.JWT_REFRESH_EXPIRES_IN ??= "7d";
delete process.env.PAYMENT_GATEWAY_ENABLED;
delete process.env.PAYMENT_GATEWAY_KEY_ID;
delete process.env.PAYMENT_GATEWAY_KEY_SECRET;
delete process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET;

type GatewayModule = typeof import("../src/payments/payment-gateway");
type RazorpayModule = typeof import("../src/payments/razorpay-gateway");

let gateway: GatewayModule;
let razorpay: RazorpayModule;

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const KEY_ID = "rzp_test_SECRETKEYID123456";
const KEY_SECRET = "test-key-secret-SECRET-abcdef123456";
const WEBHOOK_SECRET = "test-webhook-secret-SECRET-abcdef123456";

type FakeResponse = { status: number; body: string };
let currentResponse: FakeResponse = { status: 200, body: "{}" };
const recordedRequests: Array<{ path: string; authorization: string | undefined; body: unknown }> = [];
let holdConnectionsOpen = false;

const fakeServer = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += String(chunk)));
  req.on("end", () => {
    recordedRequests.push({
      path: req.url ?? "",
      authorization: req.headers.authorization,
      body: raw ? JSON.parse(raw) : null
    });
    if (holdConnectionsOpen) {
      return; // never respond: exercises the timeout path
    }
    res.writeHead(currentResponse.status, { "Content-Type": "application/json" });
    res.end(currentResponse.body);
  });
});

before(async () => {
  await new Promise<void>((resolve) => fakeServer.listen(0, "127.0.0.1", resolve));
  const address = fakeServer.address();
  assert.ok(address && typeof address === "object");

  gateway = await import("../src/payments/payment-gateway");
  razorpay = await import("../src/payments/razorpay-gateway");
});

after(() => {
  holdConnectionsOpen = false;
  fakeServer.closeAllConnections?.();
  fakeServer.close();
});

function createRazorpay(overrides: Partial<import("../src/payments/razorpay-gateway").RazorpayGatewayOptions> = {}) {
  const address = fakeServer.address();
  assert.ok(address && typeof address === "object");
  return new razorpay.RazorpayPaymentGateway({
    keyId: KEY_ID,
    keySecret: KEY_SECRET,
    baseUrl: `http://127.0.0.1:${address.port}`,
    timeoutMs: 2_000,
    ...overrides
  });
}

function runEnvProcess(childEnv: Record<string, string | undefined>): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const mergedEnv: NodeJS.ProcessEnv = { ...process.env, ...childEnv, PORT: childEnv.PORT ?? "3000" };
    const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/config/env.ts"], {
      cwd: backendRoot,
      env: mergedEnv
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => resolve({ code: code ?? -1, output }));
  });
}

const baseProductionEnv: Record<string, string> = {
  PORT: "3000",
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@db.prod.example.com:5432/db?sslmode=require",
  CORS_ORIGIN: "https://app.example.com",
  JWT_ACCESS_SECRET: "p".repeat(40),
  JWT_REFRESH_SECRET: "q".repeat(40),
  JWT_ACCESS_EXPIRES_IN: "15m",
  JWT_REFRESH_EXPIRES_IN: "7d",
  STORAGE_PROVIDER: "s3",
  STORAGE_BUCKET: "prod-bucket",
  STORAGE_REGION: "ap-south-1",
  STORAGE_ACCESS_KEY_ID: "AKIAEXAMPLE",
  STORAGE_SECRET_ACCESS_KEY: "s3-secret"
};

test("production with PAYMENT_GATEWAY_ENABLED=true and no credentials fails clearly", async () => {
  const result = await runEnvProcess({ ...baseProductionEnv, PAYMENT_GATEWAY_ENABLED: "true" });
  assert.equal(result.code, 1);
  assert.ok(result.output.includes("PAYMENT_GATEWAY_KEY_ID is required when PAYMENT_GATEWAY_ENABLED=true"));
  assert.ok(result.output.includes("PAYMENT_GATEWAY_KEY_SECRET is required when PAYMENT_GATEWAY_ENABLED=true"));
});

test("production with valid gateway credentials parses", async () => {
  const result = await runEnvProcess({
    ...baseProductionEnv,
    PAYMENT_GATEWAY_ENABLED: "true",
    PAYMENT_GATEWAY_KEY_ID: KEY_ID,
    PAYMENT_GATEWAY_KEY_SECRET: KEY_SECRET,
    PAYMENT_GATEWAY_WEBHOOK_SECRET: WEBHOOK_SECRET
  });
  assert.equal(result.code, 0);
});

test("mock gateway creates deterministic orders and verifies signatures", async () => {
  const mock = new gateway.MockPaymentGateway();
  const order = await mock.createGatewayOrder({ amountMinor: 1010, currency: "INR", receipt: "order-1" });

  assert.equal(order.gatewayOrderId, "mock_order_1");
  assert.deepEqual(mock.createdOrders, [order]);

  const paymentId = mock.simulateSuccessfulPayment(order.gatewayOrderId);
  await mock.verifyPaymentSignature({
    gatewayOrderId: order.gatewayOrderId,
    gatewayPaymentId: paymentId,
    gatewaySignature: mock.signatureFor(order.gatewayOrderId, paymentId)
  });
  const fetched = await mock.fetchGatewayPayment(paymentId);
  assert.deepEqual(fetched, {
    gatewayPaymentId: paymentId,
    gatewayOrderId: order.gatewayOrderId,
    amountMinor: 1010,
    currency: "INR",
    status: "CAPTURED"
  });

  await assert.rejects(
    async () =>
      mock.verifyPaymentSignature({
        gatewayOrderId: order.gatewayOrderId,
        gatewayPaymentId: paymentId,
        gatewaySignature: "forged"
      }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "PAYMENT_SIGNATURE_INVALID");
      return true;
    }
  );
  assert.equal(mock.verificationAttempts.length, 2);
  mock.clear();
  assert.equal(mock.createdOrders.length, 0);
});

test("Razorpay adapter posts orders with basic auth and server amounts", async () => {
  recordedRequests.length = 0;
  currentResponse = { status: 200, body: JSON.stringify({ id: "order_RZP1", amount: 1010, currency: "INR", status: "created" }) };

  const adapter = createRazorpay();
  const order = await adapter.createGatewayOrder({ amountMinor: 1010, currency: "INR", receipt: "order-uuid" });

  assert.deepEqual(order, { gatewayOrderId: "order_RZP1", amountMinor: 1010, currency: "INR", status: "created" });
  assert.equal(recordedRequests.length, 1);
  assert.equal(recordedRequests[0].path, "/v1/orders");
  const expectedAuth = `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`;
  assert.equal(recordedRequests[0].authorization, expectedAuth);
  assert.deepEqual(recordedRequests[0].body, { amount: 1010, currency: "INR", receipt: "order-uuid" });
});

test("Razorpay adapter fetches and normalizes payment status", async () => {
  recordedRequests.length = 0;
  currentResponse = {
    status: 200,
    body: JSON.stringify({ id: "pay_RZP1", order_id: "order_RZP1", amount: 1010, currency: "INR", status: "captured" })
  };

  const payment = await createRazorpay().fetchGatewayPayment("pay_RZP1");

  assert.deepEqual(payment, {
    gatewayPaymentId: "pay_RZP1",
    gatewayOrderId: "order_RZP1",
    amountMinor: 1010,
    currency: "INR",
    status: "CAPTURED"
  });
  assert.equal(recordedRequests[0].path, "/v1/payments/pay_RZP1");
});

test("gateway errors are safe and never leak the key secret", async () => {
  recordedRequests.length = 0;
  currentResponse = { status: 401, body: JSON.stringify({ error: { description: `bad key ${KEY_SECRET}` } }) };

  await assert.rejects(
    () => createRazorpay().createGatewayOrder({ amountMinor: 1, currency: "INR", receipt: "r" }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "PAYMENT_GATEWAY_ERROR");
      const rendered = `${error.message}\n${error.stack ?? ""}`;
      assert.ok(!rendered.includes(KEY_SECRET), "key secret must not leak into errors");
      assert.ok(!rendered.includes("bad key"), "gateway error body must not leak into errors");
      return true;
    }
  );

  currentResponse = { status: 200, body: "not-json" };
  await assert.rejects(
    () => createRazorpay().fetchGatewayPayment("pay_x"),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "PAYMENT_GATEWAY_ERROR");
      return true;
    }
  );
});

test("gateway timeouts and network failures map to PAYMENT_GATEWAY_UNREACHABLE", async () => {
  holdConnectionsOpen = true;
  await assert.rejects(
    () => createRazorpay({ timeoutMs: 50 }).createGatewayOrder({ amountMinor: 1, currency: "INR", receipt: "r" }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "PAYMENT_GATEWAY_UNREACHABLE");
      assert.ok(!`${error.message}${error.stack ?? ""}`.includes(KEY_SECRET));
      return true;
    }
  );
  holdConnectionsOpen = false;

  await assert.rejects(
    () => createRazorpay({ baseUrl: "http://127.0.0.1:1" }).fetchGatewayPayment("pay_x"),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "PAYMENT_GATEWAY_UNREACHABLE");
      return true;
    }
  );
});

test("Razorpay checkout signature verification is exact and constant-time safe", async () => {
  const adapter = createRazorpay();
  const { createHmac } = await import("node:crypto");
  const validSignature = createHmac("sha256", KEY_SECRET).update("order_RZP1|pay_RZP1").digest("hex");

  adapter.verifyPaymentSignature({ gatewayOrderId: "order_RZP1", gatewayPaymentId: "pay_RZP1", gatewaySignature: validSignature });

  for (const bad of ["forged", `${validSignature}0`, ""]) {
    await assert.rejects(
      async () =>
        adapter.verifyPaymentSignature({ gatewayOrderId: "order_RZP1", gatewayPaymentId: "pay_RZP1", gatewaySignature: bad }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.code, "PAYMENT_SIGNATURE_INVALID");
        return true;
      }
    );
  }
});

test("webhook signature verification accepts only genuine raw-body signatures", async () => {
  const { createHmac } = await import("node:crypto");
  const rawBody = Buffer.from(JSON.stringify({ event: "payment.captured" }));
  const valid = createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");

  assert.equal(razorpay.RazorpayPaymentGateway.verifyWebhookSignature(rawBody, valid, WEBHOOK_SECRET), true);
  assert.equal(razorpay.RazorpayPaymentGateway.verifyWebhookSignature(rawBody, "forged", WEBHOOK_SECRET), false);
  assert.equal(razorpay.RazorpayPaymentGateway.verifyWebhookSignature(rawBody, valid, "wrong-secret"), false);
});
