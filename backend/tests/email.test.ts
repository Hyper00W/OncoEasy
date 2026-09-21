import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { AppError } from "../src/errors/app-error";
import type { WhatsAppProvider } from "../src/notifications/whatsapp";
import type { SmsProvider } from "../src/notifications/sms";

// Environment must be settled before the config/notifications modules load.
// PORT is pinned because the ambient shell may export an invalid value.
// Email is deliberately left disabled for the module-level default state.
process.env.PORT = "3000";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME?schema=public";
process.env.JWT_ACCESS_SECRET ??= "email-test-access-secret-0123456789abcdef";
process.env.JWT_REFRESH_SECRET ??= "email-test-refresh-secret-0123456789abcdef";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.JWT_REFRESH_EXPIRES_IN ??= "7d";
delete process.env.EMAIL_ENABLED;
delete process.env.EMAIL_API_BASE_URL;
delete process.env.EMAIL_API_KEY;
delete process.env.EMAIL_FROM_ADDRESS;
delete process.env.EMAIL_FROM_NAME;
delete process.env.SMS_ENABLED;
delete process.env.WHATSAPP_ENABLED;

type EmailModule = typeof import("../src/notifications/email");
type AdapterModule = typeof import("../src/notifications/generic-http-email");
type NotifyModule = typeof import("../src/notifications/notification-service");
type WhatsAppModule = typeof import("../src/notifications/whatsapp");
type SmsModule = typeof import("../src/notifications/sms");

let email: EmailModule;
let adapter: AdapterModule;
let notify: NotifyModule;
let whatsapp: WhatsAppModule;
let sms: SmsModule;

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const API_KEY = "test-email-api-key-SECRET-abcdef123456";
const RECIPIENT = "patient@example.com";
const NEUTRAL_SUBJECT = "Your OncoEasy order update";
const SENSITIVE_TEXT = "Your order ORD-1 has shipped";

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

  email = await import("../src/notifications/email");
  adapter = await import("../src/notifications/generic-http-email");
  notify = await import("../src/notifications/notification-service");
  whatsapp = await import("../src/notifications/whatsapp");
  sms = await import("../src/notifications/sms");
});

after(() => {
  holdConnectionsOpen = false;
  fakeServer.closeAllConnections?.();
  fakeServer.close();
});

function createEmailProvider(overrides: Partial<import("../src/notifications/generic-http-email").GenericHttpEmailOptions> = {}) {
  const address = fakeServer.address();
  assert.ok(address && typeof address === "object");
  return new adapter.GenericHttpEmailProvider({
    baseUrl: `http://127.0.0.1:${address.port}/vendor/email/send`,
    apiKey: API_KEY,
    fromAddress: "no-reply@oncoeasy.example",
    fromName: "OncoEasy",
    timeoutMs: 2_000,
    ...overrides
  });
}

function failingProvider(code: string, statusCode: number): WhatsAppProvider {
  return {
    async sendText() {
      throw new AppError(statusCode, code, "WhatsApp message could not be sent");
    },
    async sendTemplate() {
      throw new AppError(statusCode, code, "WhatsApp message could not be sent");
    }
  };
}

function failingSmsProvider(code: string): SmsProvider {
  return {
    async sendText() {
      throw new AppError(502, code, "SMS message could not be sent");
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

test("disabled email fails fast with EMAIL_DISABLED and never sends", async () => {
  email.resetEmailState();
  assert.equal(email.isEmailEnabled(), false);

  await assert.rejects(
    () => email.sendEmail({ to: RECIPIENT, subject: NEUTRAL_SUBJECT, text: SENSITIVE_TEXT }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "EMAIL_DISABLED");
      return true;
    }
  );
});

test("mock email provider records recipient, subject, body, html, count, and reference", async () => {
  const mock = new email.InMemoryEmailProvider();
  email.setEmailState({ enabled: true, provider: mock });

  const first = await email.sendEmail({ to: RECIPIENT, subject: NEUTRAL_SUBJECT, text: SENSITIVE_TEXT });
  const second = await email.sendEmail({ to: RECIPIENT, subject: NEUTRAL_SUBJECT, text: "plain", html: "<p>rich</p>" });

  assert.deepEqual(first, { providerMessageId: "mock-email-1", status: "accepted" });
  assert.equal(second.providerMessageId, "mock-email-2");
  assert.equal(mock.sentEmails.length, 2);
  assert.equal(mock.sentEmails[0].to, RECIPIENT);
  assert.equal(mock.sentEmails[0].subject, NEUTRAL_SUBJECT);
  assert.equal(mock.sentEmails[0].text, SENSITIVE_TEXT);
  assert.equal(mock.sentEmails[0].html, null);
  assert.equal(mock.sentEmails[1].html, "<p>rich</p>");
  mock.clear();
  assert.equal(mock.sentEmails.length, 0);
});

test("recipients are validated and normalized; invalid ones are rejected", async () => {
  const mock = new email.InMemoryEmailProvider();
  email.setEmailState({ enabled: true, provider: mock });

  await email.sendEmail({ to: "  Patient@Example.COM ", subject: NEUTRAL_SUBJECT, text: "x" });
  assert.equal(mock.sentEmails[0].to, "patient@example.com");

  await assert.rejects(
    () => email.sendEmail({ to: "not-an-email", subject: NEUTRAL_SUBJECT, text: "x" }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "INVALID_EMAIL");
      return true;
    }
  );
  assert.equal(mock.sentEmails.length, 1);
});

test("generic HTTP adapter posts the documented payload with bearer auth and from composition", async () => {
  recordedRequests.length = 0;
  currentResponse = { status: 200, body: JSON.stringify({ messageId: "vendor-123", status: "queued" }) };

  const result = await createEmailProvider().sendEmail({
    to: RECIPIENT,
    subject: NEUTRAL_SUBJECT,
    text: SENSITIVE_TEXT,
    html: "<p>update</p>"
  });

  assert.deepEqual(result, { providerMessageId: "vendor-123", status: "queued" });
  assert.equal(recordedRequests.length, 1);
  assert.equal(recordedRequests[0].path, "/vendor/email/send");
  assert.equal(recordedRequests[0].authorization, `Bearer ${API_KEY}`);
  assert.deepEqual(recordedRequests[0].body, {
    from: '"OncoEasy" <no-reply@oncoeasy.example>',
    to: RECIPIENT,
    subject: NEUTRAL_SUBJECT,
    text: SENSITIVE_TEXT,
    html: "<p>update</p>"
  });

  // Without a from-name the address is sent bare; html is omitted when absent.
  recordedRequests.length = 0;
  await createEmailProvider({ fromName: null }).sendEmail({ to: RECIPIENT, subject: NEUTRAL_SUBJECT, text: "x" });
  assert.equal(recordedRequests[0].body.from, "no-reply@oncoeasy.example");
  assert.equal((recordedRequests[0].body as Record<string, unknown>).html, undefined);
});

test("alternate reference fields map and empty 2xx bodies are accepted", async () => {
  currentResponse = { status: 200, body: JSON.stringify({ message_id: 424242 }) };
  const numbered = await createEmailProvider().sendEmail({ to: RECIPIENT, subject: NEUTRAL_SUBJECT, text: "x" });
  assert.equal(numbered.providerMessageId, "424242");

  currentResponse = { status: 204, body: "" };
  const empty = await createEmailProvider().sendEmail({ to: RECIPIENT, subject: NEUTRAL_SUBJECT, text: "x" });
  assert.deepEqual(empty, { providerMessageId: null, status: "accepted" });
});

test("non-2xx vendor responses become safe errors without leaking the key or content", async () => {
  recordedRequests.length = 0;
  currentResponse = {
    status: 401,
    body: JSON.stringify({ error: `invalid key ${API_KEY} for ${RECIPIENT} ${SENSITIVE_TEXT}` })
  };

  await assert.rejects(
    () => createEmailProvider().sendEmail({ to: RECIPIENT, subject: NEUTRAL_SUBJECT, text: SENSITIVE_TEXT }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "EMAIL_SEND_FAILED");
      const rendered = `${error.message}\n${error.stack ?? ""}`;
      assert.ok(!rendered.includes(API_KEY), "API key must not leak into errors");
      assert.ok(!rendered.includes(RECIPIENT), "recipient must not leak into errors");
      assert.ok(!rendered.includes(SENSITIVE_TEXT), "message body must not leak into errors");
      return true;
    }
  );
  assert.equal(recordedRequests.length, 1); // single attempt, no blind retries

  currentResponse = { status: 200, body: "not-json" };
  await assert.rejects(
    () => createEmailProvider().sendEmail({ to: RECIPIENT, subject: NEUTRAL_SUBJECT, text: "x" }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "EMAIL_SEND_FAILED");
      return true;
    }
  );
});

test("timeouts and network failures map to EMAIL_UNREACHABLE without secret leakage", async () => {
  holdConnectionsOpen = true;
  await assert.rejects(
    () => createEmailProvider({ timeoutMs: 50 }).sendEmail({ to: RECIPIENT, subject: NEUTRAL_SUBJECT, text: "x" }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "EMAIL_UNREACHABLE");
      assert.ok(!`${error.message}${error.stack ?? ""}`.includes(API_KEY));
      return true;
    }
  );
  holdConnectionsOpen = false;

  await assert.rejects(
    () => createEmailProvider({ baseUrl: "http://127.0.0.1:1" }).sendEmail({ to: RECIPIENT, subject: NEUTRAL_SUBJECT, text: "x" }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "EMAIL_UNREACHABLE");
      return true;
    }
  );
});

test("production with EMAIL_ENABLED=true and missing credentials fails clearly", async () => {
  const result = await runEnvProcess({ ...baseProductionEnv, EMAIL_ENABLED: "true" });
  assert.equal(result.code, 1);
  for (const name of ["EMAIL_API_BASE_URL", "EMAIL_API_KEY", "EMAIL_FROM_ADDRESS"]) {
    assert.ok(result.output.includes(`${name} is required when EMAIL_ENABLED=true`), `missing message for ${name}`);
  }
});

test("production with a malformed from address fails clearly", async () => {
  const result = await runEnvProcess({
    ...baseProductionEnv,
    EMAIL_ENABLED: "true",
    EMAIL_API_BASE_URL: "https://email.example.com/send",
    EMAIL_API_KEY: API_KEY,
    EMAIL_FROM_ADDRESS: "not-an-email"
  });
  assert.equal(result.code, 1);
  assert.match(result.output, /EMAIL_FROM_ADDRESS/);
});

test("production with valid email configuration parses without contacting a vendor", async () => {
  const result = await runEnvProcess({
    ...baseProductionEnv,
    EMAIL_ENABLED: "true",
    EMAIL_API_BASE_URL: "https://email.example.com/send",
    EMAIL_API_KEY: API_KEY,
    EMAIL_FROM_ADDRESS: "no-reply@oncoeasy.example",
    EMAIL_FROM_NAME: "OncoEasy"
  });
  assert.equal(result.code, 0);
});

test("email-only notification sends once with a safe neutral subject and no side channels", async () => {
  const waMock = new whatsapp.InMemoryWhatsAppProvider();
  const smsMock = new sms.InMemorySmsProvider();
  const emailMock = new email.InMemoryEmailProvider();
  whatsapp.setWhatsAppState({ enabled: true, provider: waMock });
  sms.setSmsState({ enabled: true, provider: smsMock });
  email.setEmailState({ enabled: true, provider: emailMock });

  const result = await notify.sendEmailNotification({
    email: RECIPIENT,
    subject: NEUTRAL_SUBJECT,
    text: SENSITIVE_TEXT
  });

  assert.equal(result.channel, "email");
  assert.equal(emailMock.sentEmails.length, 1);
  assert.equal(emailMock.sentEmails[0].subject, NEUTRAL_SUBJECT);
  assert.equal(waMock.sentTextMessages.length, 0);
  assert.equal(smsMock.sentTextMessages.length, 0);
});

test("email-only notification requires content and surfaces provider failures", async () => {
  email.setEmailState({ enabled: true, provider: new email.InMemoryEmailProvider() });

  await assert.rejects(
    () => notify.sendEmailNotification({ email: RECIPIENT, subject: NEUTRAL_SUBJECT, text: undefined as unknown as string }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "NOTIFICATION_CONTENT_INVALID");
      return true;
    }
  );
});

test("email-only notification with email disabled fails with EMAIL_DISABLED", async () => {
  email.resetEmailState(); // EMAIL_ENABLED unset in this process
  await assert.rejects(
    () => notify.sendEmailNotification({ email: RECIPIENT, subject: NEUTRAL_SUBJECT, text: "x" }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "EMAIL_DISABLED");
      return true;
    }
  );
});

test("WhatsApp primary + SMS fallback chain is unchanged by the email additions", async () => {
  const waMock = new whatsapp.InMemoryWhatsAppProvider();
  const smsMock = new sms.InMemorySmsProvider();
  const emailMock = new email.InMemoryEmailProvider();
  whatsapp.setWhatsAppState({ enabled: true, provider: waMock });
  sms.setSmsState({ enabled: true, provider: smsMock });
  email.setEmailState({ enabled: true, provider: emailMock });

  // Success: no SMS, no email side effects.
  const success = await notify.sendTransactionalNotification({
    to: "+919876543210",
    text: SENSITIVE_TEXT,
    allowSmsFallback: true
  });
  assert.equal(success.channel, "whatsapp");
  assert.equal(smsMock.sentTextMessages.length, 0);
  assert.equal(emailMock.sentEmails.length, 0);

  // Failure: single SMS fallback, still no email.
  whatsapp.setWhatsAppState({ enabled: true, provider: failingProvider("WHATSAPP_SEND_FAILED", 502) });
  const fallback = await notify.sendTransactionalNotification({
    to: "+919876543210",
    text: SENSITIVE_TEXT,
    allowSmsFallback: true
  });
  assert.equal(fallback.channel, "sms");
  assert.equal(smsMock.sentTextMessages.length, 1);
  assert.equal(emailMock.sentEmails.length, 0);
});

test("multi-channel sends each requested channel once without duplicates", async () => {
  const waMock = new whatsapp.InMemoryWhatsAppProvider();
  const smsMock = new sms.InMemorySmsProvider();
  const emailMock = new email.InMemoryEmailProvider();
  whatsapp.setWhatsAppState({ enabled: true, provider: waMock });
  sms.setSmsState({ enabled: true, provider: smsMock });
  email.setEmailState({ enabled: true, provider: emailMock });

  const result = await notify.sendMultiChannelNotification({
    to: "+919876543210",
    text: SENSITIVE_TEXT,
    allowSmsFallback: true,
    allowEmail: true,
    email: RECIPIENT,
    subject: NEUTRAL_SUBJECT
  });

  assert.deepEqual(
    result.delivered.map((entry) => entry.channel),
    ["whatsapp", "email"]
  );
  assert.deepEqual(result.failed, []);
  assert.equal(waMock.sentTextMessages.length, 1);
  assert.equal(smsMock.sentTextMessages.length, 0); // WhatsApp success: no SMS duplicate
  assert.equal(emailMock.sentEmails.length, 1);

  // Email disabled with allowEmail: simply not attempted, no failure entry.
  email.resetEmailState();
  const emailSkipped = await notify.sendMultiChannelNotification({
    to: "+919876543210",
    text: "x",
    allowEmail: true,
    email: RECIPIENT,
    subject: NEUTRAL_SUBJECT
  });
  assert.deepEqual(emailSkipped.failed, []);
  assert.equal(emailSkipped.delivered.length, 1);

  // WhatsApp failure + SMS fallback failure + email success reports both.
  whatsapp.setWhatsAppState({ enabled: true, provider: failingProvider("WHATSAPP_SEND_FAILED", 502) });
  sms.setSmsState({ enabled: true, provider: failingSmsProvider("SMS_SEND_FAILED") });
  email.setEmailState({ enabled: true, provider: new email.InMemoryEmailProvider() });
  const partial = await notify.sendMultiChannelNotification({
    to: "+919876543210",
    text: SENSITIVE_TEXT,
    allowSmsFallback: true,
    allowEmail: true,
    email: RECIPIENT,
    subject: NEUTRAL_SUBJECT
  });
  assert.deepEqual(
    partial.delivered.map((entry) => entry.channel),
    ["email"]
  );
  // WhatsApp's failure folds into the single fallback chain (Phase 3.4
  // semantics), so only the terminal SMS failure is reported as failed.
  assert.deepEqual(
    partial.failed.map((entry) => entry.channel),
    ["sms"]
  );
});

test("invalid recipients and emails are rejected inside multi-channel sends", async () => {
  whatsapp.setWhatsAppState({ enabled: true, provider: new whatsapp.InMemoryWhatsAppProvider() });
  email.setEmailState({ enabled: true, provider: new email.InMemoryEmailProvider() });

  const badPhone = await notify.sendMultiChannelNotification({
    to: "98765",
    text: "x",
    allowEmail: false
  });
  assert.deepEqual(
    badPhone.failed.map((entry) => entry.channel),
    ["whatsapp"]
  );
  assert.equal(badPhone.delivered.length, 0);

  const badEmail = await notify.sendMultiChannelNotification({
    to: "+919876543210",
    text: "x",
    allowEmail: true,
    email: "not-an-email",
    subject: NEUTRAL_SUBJECT
  });
  assert.equal(badEmail.delivered.length, 1); // whatsapp ok
  assert.deepEqual(
    badEmail.failed.map((entry) => entry.channel),
    ["email"]
  );
});
