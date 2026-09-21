import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { AppError } from "../src/errors/app-error";
import type { WhatsAppProvider } from "../src/notifications/whatsapp";

// Environment must be settled before the config/notifications modules load.
// PORT is pinned because the ambient shell may export an invalid value.
// SMS is deliberately left disabled for the module-level default state.
process.env.PORT = "3000";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME?schema=public";
process.env.JWT_ACCESS_SECRET ??= "sms-test-access-secret-0123456789abcdef";
process.env.JWT_REFRESH_SECRET ??= "sms-test-refresh-secret-0123456789abcdef";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.JWT_REFRESH_EXPIRES_IN ??= "7d";
delete process.env.SMS_ENABLED;
delete process.env.SMS_API_BASE_URL;
delete process.env.SMS_API_KEY;
delete process.env.SMS_SENDER_ID;
delete process.env.WHATSAPP_ENABLED;

type SmsModule = typeof import("../src/notifications/sms");
type AdapterModule = typeof import("../src/notifications/generic-http-sms");
type NotifyModule = typeof import("../src/notifications/notification-service");
type WhatsAppModule = typeof import("../src/notifications/whatsapp");

let sms: SmsModule;
let adapter: AdapterModule;
let notify: NotifyModule;
let whatsapp: WhatsAppModule;

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const API_KEY = "test-sms-api-key-SECRET-abcdef123456";
const SENSITIVE_BODY = "Your appointment is confirmed for 2026-09-21 at 10:00";

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

  sms = await import("../src/notifications/sms");
  adapter = await import("../src/notifications/generic-http-sms");
  notify = await import("../src/notifications/notification-service");
  whatsapp = await import("../src/notifications/whatsapp");
});

after(() => {
  holdConnectionsOpen = false;
  fakeServer.closeAllConnections?.();
  fakeServer.close();
});

function createSmsProvider(overrides: Partial<import("../src/notifications/generic-http-sms").GenericHttpSmsOptions> = {}) {
  const address = fakeServer.address();
  assert.ok(address && typeof address === "object");
  return new adapter.GenericHttpSmsProvider({
    baseUrl: `http://127.0.0.1:${address.port}/gateway/sms/send`,
    apiKey: API_KEY,
    senderId: "ONCOEASY",
    timeoutMs: 2_000,
    ...overrides
  });
}

function failingWhatsAppProvider(code: string, statusCode: number): WhatsAppProvider {
  return {
    async sendText() {
      throw new AppError(statusCode, code, "WhatsApp message could not be sent");
    },
    async sendTemplate() {
      throw new AppError(statusCode, code, "WhatsApp message could not be sent");
    }
  };
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

test("disabled SMS fails fast with SMS_DISABLED and never sends", async () => {
  sms.resetSmsState();
  assert.equal(sms.isSmsEnabled(), false);

  await assert.rejects(
    () => sms.sendSmsText({ to: "+919876543210", text: SENSITIVE_BODY }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "SMS_DISABLED");
      return true;
    }
  );
});

test("mock SMS provider records text sends deterministically", async () => {
  const mock = new sms.InMemorySmsProvider();
  sms.setSmsState({ enabled: true, provider: mock });

  const result = await sms.sendSmsText({ to: "+919876543210", text: SENSITIVE_BODY });

  assert.deepEqual(result, { providerMessageId: "mock-sms-1", status: "accepted" });
  assert.equal(mock.sentTextMessages.length, 1);
  assert.equal(mock.sentTextMessages[0].to, "+919876543210");
  assert.equal(mock.sentTextMessages[0].text, SENSITIVE_BODY);

  const second = await sms.sendSmsText({ to: "+919876543210", text: "second" });
  assert.equal(second.providerMessageId, "mock-sms-2");
  mock.clear();
  assert.equal(mock.sentTextMessages.length, 0);
});

test("SMS recipients are normalized with the auth phone utility and invalid ones are rejected", async () => {
  const mock = new sms.InMemorySmsProvider();
  sms.setSmsState({ enabled: true, provider: mock });

  await sms.sendSmsText({ to: "  +91 (98765) 43210 ", text: "x" });
  assert.equal(mock.sentTextMessages[0].to, "+919876543210");

  await assert.rejects(
    () => sms.sendSmsText({ to: "98765", text: "x" }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "INVALID_PHONE");
      return true;
    }
  );
  assert.equal(mock.sentTextMessages.length, 1);
});

test("generic HTTP adapter posts the documented payload with bearer auth", async () => {
  recordedRequests.length = 0;
  currentResponse = { status: 200, body: JSON.stringify({ messageId: "gw-123", status: "queued" }) };

  const provider = createSmsProvider();
  const result = await provider.sendText({ to: "+919876543210", text: SENSITIVE_BODY });

  assert.deepEqual(result, { providerMessageId: "gw-123", status: "queued" });
  assert.equal(recordedRequests.length, 1);
  const request = recordedRequests[0];
  assert.equal(request.path, "/gateway/sms/send");
  assert.equal(request.authorization, `Bearer ${API_KEY}`);
  assert.deepEqual(request.body, { to: "+919876543210", text: SENSITIVE_BODY, from: "ONCOEASY" });
});

test("adapter omits the sender field when none is configured and maps alternate reference fields", async () => {
  recordedRequests.length = 0;
  currentResponse = { status: 200, body: JSON.stringify({ message_id: 424242 }) };

  const provider = createSmsProvider({ senderId: null });
  const result = await provider.sendText({ to: "+919876543210", text: "x" });

  assert.deepEqual(result, { providerMessageId: "424242", status: "accepted" });
  assert.deepEqual(recordedRequests[0].body, { to: "+919876543210", text: "x" });

  recordedRequests.length = 0;
  currentResponse = { status: 200, body: JSON.stringify({ sid: "SM-alt" }) };
  const alt = await createSmsProvider({ senderId: null }).sendText({ to: "+919876543210", text: "x" });
  assert.equal(alt.providerMessageId, "SM-alt");
});

test("adapter treats an empty 2xx body as accepted without a reference", async () => {
  recordedRequests.length = 0;
  currentResponse = { status: 204, body: "" };

  const result = await createSmsProvider().sendText({ to: "+919876543210", text: "x" });
  assert.deepEqual(result, { providerMessageId: null, status: "accepted" });
});

test("non-2xx gateway responses become safe errors without leaking the key or body", async () => {
  recordedRequests.length = 0;
  currentResponse = {
    status: 401,
    body: JSON.stringify({ error: `invalid key ${API_KEY} for ${SENSITIVE_BODY}` })
  };

  await assert.rejects(
    () => createSmsProvider().sendText({ to: "+919876543210", text: SENSITIVE_BODY }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "SMS_SEND_FAILED");
      const rendered = `${error.message}\n${error.stack ?? ""}`;
      assert.ok(!rendered.includes(API_KEY), "API key must not leak into errors");
      assert.ok(!rendered.includes(SENSITIVE_BODY), "message body must not leak into errors");
      return true;
    }
  );
  assert.equal(recordedRequests.length, 1); // single attempt, no blind retries
});

test("malformed gateway JSON is treated as a send failure", async () => {
  recordedRequests.length = 0;
  currentResponse = { status: 200, body: "not-json" };

  await assert.rejects(
    () => createSmsProvider().sendText({ to: "+919876543210", text: "x" }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "SMS_SEND_FAILED");
      return true;
    }
  );
});

test("timeouts and network failures map to SMS_UNREACHABLE without secret leakage", async () => {
  holdConnectionsOpen = true;
  await assert.rejects(
    () => createSmsProvider({ timeoutMs: 50 }).sendText({ to: "+919876543210", text: "x" }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "SMS_UNREACHABLE");
      assert.ok(!`${error.message}${error.stack ?? ""}`.includes(API_KEY));
      return true;
    }
  );
  holdConnectionsOpen = false;

  await assert.rejects(
    () => createSmsProvider({ baseUrl: "http://127.0.0.1:1" }).sendText({ to: "+919876543210", text: "x" }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "SMS_UNREACHABLE");
      return true;
    }
  );
});

test("production with SMS_ENABLED=true and no credentials fails clearly", async () => {
  const result = await runEnvProcess({ ...baseProductionEnv, SMS_ENABLED: "true" });
  assert.equal(result.code, 1);
  assert.ok(result.output.includes("SMS_API_BASE_URL is required when SMS_ENABLED=true"));
  assert.ok(result.output.includes("SMS_API_KEY is required when SMS_ENABLED=true"));
});

test("production with valid SMS configuration parses without contacting a gateway", async () => {
  const result = await runEnvProcess({
    ...baseProductionEnv,
    SMS_ENABLED: "true",
    SMS_API_BASE_URL: "https://sms-gateway.example.com/send",
    SMS_API_KEY: API_KEY,
    SMS_SENDER_ID: "ONCOEASY"
  });
  assert.equal(result.code, 0);
});

test("WhatsApp success never triggers a duplicate SMS", async () => {
  const waMock = new whatsapp.InMemoryWhatsAppProvider();
  const smsMock = new sms.InMemorySmsProvider();
  whatsapp.setWhatsAppState({ enabled: true, provider: waMock });
  sms.setSmsState({ enabled: true, provider: smsMock });

  const result = await notify.sendTransactionalNotification({
    to: "+919876543210",
    text: SENSITIVE_BODY,
    allowSmsFallback: true
  });

  assert.equal(result.channel, "whatsapp");
  assert.equal(waMock.sentTextMessages.length, 1);
  assert.equal(smsMock.sentTextMessages.length, 0); // no duplicate
});

test("WhatsApp failure with SMS enabled and opted in falls back to a single SMS", async () => {
  const waMock = new whatsapp.InMemoryWhatsAppProvider();
  const smsMock = new sms.InMemorySmsProvider();
  whatsapp.setWhatsAppState({ enabled: true, provider: failingWhatsAppProvider("WHATSAPP_SEND_FAILED", 502) });
  sms.setSmsState({ enabled: true, provider: smsMock });

  const result = await notify.sendTransactionalNotification({
    to: "+919876543210",
    text: SENSITIVE_BODY,
    allowSmsFallback: true
  });

  assert.equal(result.channel, "sms");
  assert.equal(smsMock.sentTextMessages.length, 1);
  assert.equal(smsMock.sentTextMessages[0].text, SENSITIVE_BODY);
});

test("WhatsApp disabled with SMS enabled and opted in falls back to SMS", async () => {
  const smsMock = new sms.InMemorySmsProvider();
  whatsapp.resetWhatsAppState(); // WHATSAPP_ENABLED is unset in this process
  sms.setSmsState({ enabled: true, provider: smsMock });

  const result = await notify.sendTransactionalNotification({
    to: "+919876543210",
    text: SENSITIVE_BODY,
    allowSmsFallback: true
  });

  assert.equal(result.channel, "sms");
  assert.equal(smsMock.sentTextMessages.length, 1);
});

test("WhatsApp failure with SMS disabled surfaces the original safe failure", async () => {
  whatsapp.setWhatsAppState({ enabled: true, provider: failingWhatsAppProvider("WHATSAPP_UNREACHABLE", 502) });
  sms.resetSmsState(); // SMS disabled

  await assert.rejects(
    () =>
      notify.sendTransactionalNotification({
        to: "+919876543210",
        text: SENSITIVE_BODY,
        allowSmsFallback: true
      }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "WHATSAPP_UNREACHABLE");
      return true;
    }
  );
});

test("WhatsApp failure without fallback opt-in is not retried over SMS", async () => {
  const smsMock = new sms.InMemorySmsProvider();
  whatsapp.setWhatsAppState({ enabled: true, provider: failingWhatsAppProvider("WHATSAPP_SEND_FAILED", 502) });
  sms.setSmsState({ enabled: true, provider: smsMock });

  await assert.rejects(
    () => notify.sendTransactionalNotification({ to: "+919876543210", text: SENSITIVE_BODY }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "WHATSAPP_SEND_FAILED");
      return true;
    }
  );
  assert.equal(smsMock.sentTextMessages.length, 0);
});

test("both channels failing yields a constant NOTIFICATION_FAILED error", async () => {
  const smsMock = new sms.InMemorySmsProvider();
  whatsapp.setWhatsAppState({ enabled: true, provider: failingWhatsAppProvider("WHATSAPP_SEND_FAILED", 502) });
  sms.setSmsState({ enabled: true, provider: failingWhatsAppProvider("SMS_SEND_FAILED", 502) as never });

  await assert.rejects(
    () =>
      notify.sendTransactionalNotification({
        to: "+919876543210",
        text: SENSITIVE_BODY,
        allowSmsFallback: true
      }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "NOTIFICATION_FAILED");
      const rendered = `${error.message}\n${error.stack ?? ""}`;
      assert.ok(!rendered.includes(SENSITIVE_BODY));
      return true;
    }
  );
});

test("invalid recipients are rejected before any channel is attempted", async () => {
  const waMock = new whatsapp.InMemoryWhatsAppProvider();
  const smsMock = new sms.InMemorySmsProvider();
  whatsapp.setWhatsAppState({ enabled: true, provider: waMock });
  sms.setSmsState({ enabled: true, provider: smsMock });

  await assert.rejects(
    () =>
      notify.sendTransactionalNotification({
        to: "98765",
        text: SENSITIVE_BODY,
        allowSmsFallback: true
      }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "INVALID_PHONE");
      return true;
    }
  );
  assert.equal(waMock.sentTextMessages.length, 0);
  assert.equal(smsMock.sentTextMessages.length, 0);
});

test("template notifications send over WhatsApp with the template payload", async () => {
  const waMock = new whatsapp.InMemoryWhatsAppProvider();
  const smsMock = new sms.InMemorySmsProvider();
  whatsapp.setWhatsAppState({ enabled: true, provider: waMock });
  sms.setSmsState({ enabled: true, provider: smsMock });

  const result = await notify.sendTransactionalNotification({
    to: "+919876543210",
    text: SENSITIVE_BODY,
    template: { name: "order_update", languageCode: "en", parameters: ["ORD-1"] }
  });

  assert.equal(result.channel, "whatsapp");
  assert.equal(waMock.sentTemplateMessages.length, 1);
  assert.equal(waMock.sentTemplateMessages[0].template.name, "order_update");
  assert.equal(smsMock.sentTextMessages.length, 0);
});
