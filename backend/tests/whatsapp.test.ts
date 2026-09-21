import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { AppError } from "../src/errors/app-error";

// Environment must be settled before the config/notifications modules load.
// PORT is pinned because the ambient shell may export an invalid value.
// WhatsApp is deliberately left disabled for the module-level default state.
process.env.PORT = "3000";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME?schema=public";
process.env.JWT_ACCESS_SECRET ??= "whatsapp-test-access-secret-0123456789abcdef";
process.env.JWT_REFRESH_SECRET ??= "whatsapp-test-refresh-secret-0123456789abcdef";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.JWT_REFRESH_EXPIRES_IN ??= "7d";
delete process.env.WHATSAPP_ENABLED;
delete process.env.WHATSAPP_API_BASE_URL;
delete process.env.WHATSAPP_API_VERSION;
delete process.env.WHATSAPP_PHONE_NUMBER_ID;
delete process.env.WHATSAPP_ACCESS_TOKEN;

type WhatsAppModule = typeof import("../src/notifications/whatsapp");
type MetaModule = typeof import("../src/notifications/meta-whatsapp");

let whatsapp: WhatsAppModule;
let meta: MetaModule;

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ACCESS_TOKEN = "test-access-token-SECRET-abcdef123456";
const SENSITIVE_BODY = "Your referral link: https://oncoeasy.example/r/secret-code";

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
  process.env.WHATSAPP_FAKE_PORT = String(address.port);

  whatsapp = await import("../src/notifications/whatsapp");
  meta = await import("../src/notifications/meta-whatsapp");
});

after(() => {
  holdConnectionsOpen = false;
  fakeServer.closeAllConnections?.();
  fakeServer.close();
});

function createMetaProvider(overrides: Partial<import("../src/notifications/meta-whatsapp").MetaWhatsAppOptions> = {}) {
  const address = fakeServer.address();
  assert.ok(address && typeof address === "object");
  return new meta.MetaWhatsAppProvider({
    baseUrl: `http://127.0.0.1:${address.port}`,
    apiVersion: "v21.0",
    phoneNumberId: "1234567890",
    accessToken: ACCESS_TOKEN,
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

test("disabled WhatsApp fails fast with WHATSAPP_DISABLED and never sends", async () => {
  whatsapp.resetWhatsAppState();
  assert.equal(whatsapp.isWhatsAppEnabled(), false);

  await assert.rejects(
    () => whatsapp.sendWhatsAppText({ to: "+919876543210", body: SENSITIVE_BODY }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "WHATSAPP_DISABLED");
      return true;
    }
  );
});

test("mock provider records text sends deterministically", async () => {
  const mock = new whatsapp.InMemoryWhatsAppProvider();
  whatsapp.setWhatsAppState({ enabled: true, provider: mock });

  const result = await whatsapp.sendWhatsAppText({ to: "+919876543210", body: SENSITIVE_BODY });

  assert.deepEqual(result, { providerMessageId: "mock-1", status: "accepted" });
  assert.equal(mock.sentTextMessages.length, 1);
  assert.equal(mock.sentTextMessages[0].to, "+919876543210");
  assert.equal(mock.sentTextMessages[0].body, SENSITIVE_BODY);

  const second = await whatsapp.sendWhatsAppText({ to: "+919876543210", body: "second" });
  assert.equal(second.providerMessageId, "mock-2");
  mock.clear();
  assert.equal(mock.sentTextMessages.length, 0);
});

test("mock provider records template sends with name, language and parameters", async () => {
  const mock = new whatsapp.InMemoryWhatsAppProvider();
  whatsapp.setWhatsAppState({ enabled: true, provider: mock });

  const result = await whatsapp.sendWhatsAppTemplate({
    to: "+919876543210",
    template: { name: "appointment_reminder", languageCode: "en", parameters: ["Dr. Rao", "2026-09-21"] }
  });

  assert.equal(result.status, "accepted");
  assert.equal(mock.sentTemplateMessages.length, 1);
  assert.equal(mock.sentTemplateMessages[0].template.name, "appointment_reminder");
  assert.equal(mock.sentTemplateMessages[0].template.languageCode, "en");
  assert.deepEqual(mock.sentTemplateMessages[0].template.parameters, ["Dr. Rao", "2026-09-21"]);
});

test("recipients are normalized with the auth phone utility and invalid ones are rejected", async () => {
  const mock = new whatsapp.InMemoryWhatsAppProvider();
  whatsapp.setWhatsAppState({ enabled: true, provider: mock });

  await whatsapp.sendWhatsAppText({ to: "  +91 (98765) 43210 ", body: "x" });
  assert.equal(mock.sentTextMessages[0].to, "+919876543210");

  await assert.rejects(
    () => whatsapp.sendWhatsAppText({ to: "98765", body: "x" }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "INVALID_PHONE");
      return true;
    }
  );
  assert.equal(mock.sentTextMessages.length, 1);
});

test("Meta provider posts the documented text payload to the configured endpoint", async () => {
  recordedRequests.length = 0;
  currentResponse = {
    status: 200,
    body: JSON.stringify({ messages: [{ id: "wamid.test-1", message_status: "accepted" }] })
  };

  const provider = createMetaProvider();
  const result = await provider.sendText({ to: "+919876543210", body: SENSITIVE_BODY });

  assert.deepEqual(result, { providerMessageId: "wamid.test-1", status: "accepted" });
  assert.equal(recordedRequests.length, 1);
  const request = recordedRequests[0];
  assert.equal(request.path, "/v21.0/1234567890/messages");
  assert.equal(request.authorization, `Bearer ${ACCESS_TOKEN}`);
  const body = request.body as Record<string, unknown>;
  assert.equal(body.messaging_product, "whatsapp");
  assert.equal(body.recipient_type, "individual");
  assert.equal(body.to, "+919876543210");
  assert.equal(body.type, "text");
  assert.deepEqual(body.text, { body: SENSITIVE_BODY });
});

test("Meta provider sends template payloads with language and parameter components", async () => {
  recordedRequests.length = 0;
  currentResponse = { status: 200, body: JSON.stringify({ messages: [{ id: "wamid.test-2" }] }) };

  const provider = createMetaProvider();
  const result = await provider.sendTemplate({
    to: "+919876543210",
    template: { name: "order_update", languageCode: "en_US", parameters: ["ORD-1", "shipped"] }
  });

  assert.deepEqual(result, { providerMessageId: "wamid.test-2", status: "accepted" });
  const body = recordedRequests[0].body as Record<string, unknown>;
  assert.equal(body.type, "template");
  const template = body.template as Record<string, unknown>;
  assert.equal(template.name, "order_update");
  assert.deepEqual(template.language, { code: "en_US" });
  const components = template.components as Array<Record<string, unknown>>;
  assert.deepEqual(components[0].parameters, [
    { type: "text", text: "ORD-1" },
    { type: "text", text: "shipped" }
  ]);
});

test("non-2xx provider responses become safe errors without leaking the token or body", async () => {
  recordedRequests.length = 0;
  currentResponse = {
    status: 400,
    body: JSON.stringify({ error: { message: `bad token ${ACCESS_TOKEN}` } })
  };

  const provider = createMetaProvider();
  await assert.rejects(
    () => provider.sendText({ to: "+919876543210", body: SENSITIVE_BODY }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "WHATSAPP_SEND_FAILED");
      const rendered = `${error.message}\n${error.stack ?? ""}`;
      assert.ok(!rendered.includes(ACCESS_TOKEN), "access token must not leak into errors");
      assert.ok(!rendered.includes(SENSITIVE_BODY), "message body must not leak into errors");
      assert.ok(!rendered.includes("bad token"), "provider response body must not leak into errors");
      return true;
    }
  );
  assert.equal(recordedRequests.length, 1); // single attempt, no blind retries
});

test("timeouts and network failures map to WHATSAPP_UNREACHABLE without secret leakage", async () => {
  // Timeout: the fake server holds the connection open and never responds.
  holdConnectionsOpen = true;
  const timeoutProvider = createMetaProvider({ timeoutMs: 50 });
  await assert.rejects(
    () => timeoutProvider.sendText({ to: "+919876543210", body: SENSITIVE_BODY }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "WHATSAPP_UNREACHABLE");
      const rendered = `${error.message}\n${error.stack ?? ""}`;
      assert.ok(!rendered.includes(ACCESS_TOKEN));
      return true;
    }
  );
  holdConnectionsOpen = false;

  // Network failure: nothing is listening on this port.
  const unreachableProvider = createMetaProvider({ baseUrl: "http://127.0.0.1:1" });
  await assert.rejects(
    () => unreachableProvider.sendText({ to: "+919876543210", body: SENSITIVE_BODY }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "WHATSAPP_UNREACHABLE");
      assert.ok(!`${error.message}${error.stack ?? ""}`.includes(ACCESS_TOKEN));
      return true;
    }
  );
});

test("malformed provider JSON is treated as a send failure", async () => {
  recordedRequests.length = 0;
  currentResponse = { status: 200, body: "not-json" };

  const provider = createMetaProvider();
  await assert.rejects(
    () => provider.sendText({ to: "+919876543210", body: "x" }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "WHATSAPP_SEND_FAILED");
      return true;
    }
  );
});

test("state override and reset restore the configured behavior", async () => {
  const mock = new whatsapp.InMemoryWhatsAppProvider();
  whatsapp.setWhatsAppState({ enabled: true, provider: mock });
  assert.equal(whatsapp.isWhatsAppEnabled(), true);
  await whatsapp.sendWhatsAppText({ to: "+919876543210", body: "x" });
  assert.equal(mock.sentTextMessages.length, 1);

  whatsapp.resetWhatsAppState();
  assert.equal(whatsapp.isWhatsAppEnabled(), false); // WHATSAPP_ENABLED is unset in this test process
  await assert.rejects(
    () => whatsapp.sendWhatsAppText({ to: "+919876543210", body: "x" }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "WHATSAPP_DISABLED");
      return true;
    }
  );
});

test("production with WHATSAPP_ENABLED=true and no credentials fails clearly", async () => {
  const result = await runEnvProcess({ ...baseProductionEnv, WHATSAPP_ENABLED: "true" });
  assert.equal(result.code, 1);
  for (const name of [
    "WHATSAPP_API_BASE_URL",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_API_VERSION"
  ]) {
    assert.ok(result.output.includes(`${name} is required when WHATSAPP_ENABLED=true`), `missing message for ${name}`);
  }
});

test("production with valid WhatsApp configuration parses without contacting Meta", async () => {
  const result = await runEnvProcess({
    ...baseProductionEnv,
    WHATSAPP_ENABLED: "true",
    WHATSAPP_API_BASE_URL: "https://graph.facebook.com",
    WHATSAPP_API_VERSION: "v21.0",
    WHATSAPP_PHONE_NUMBER_ID: "1234567890",
    WHATSAPP_ACCESS_TOKEN: ACCESS_TOKEN
  });
  assert.equal(result.code, 0);
});

test("invalid WHATSAPP_API_VERSION is rejected with a clear message", async () => {
  const result = await runEnvProcess({
    ...baseProductionEnv,
    WHATSAPP_ENABLED: "true",
    WHATSAPP_API_BASE_URL: "https://graph.facebook.com",
    WHATSAPP_API_VERSION: "twenty-one",
    WHATSAPP_PHONE_NUMBER_ID: "1234567890",
    WHATSAPP_ACCESS_TOKEN: ACCESS_TOKEN
  });
  assert.equal(result.code, 1);
  assert.ok(result.output.includes("WHATSAPP_API_VERSION must look like v21.0"));
});
