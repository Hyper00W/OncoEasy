import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { AppError } from "../src/errors/app-error";
import { S3PrivateStorage } from "../src/storage/s3-private-storage";

// Environment must be settled before the config/storage modules load.
// PORT is pinned because the ambient shell may export an invalid value.
process.env.PORT = "3000";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME?schema=public";
process.env.JWT_ACCESS_SECRET ??= "storage-test-access-secret-0123456789abcdef";
process.env.JWT_REFRESH_SECRET ??= "storage-test-refresh-secret-0123456789abcdef";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.JWT_REFRESH_EXPIRES_IN ??= "7d";
process.env.STORAGE_PROVIDER = "in-memory";

type StorageModule = typeof import("../src/storage/private-storage");

let storage: StorageModule;
let env: StorageModule extends never ? never : (typeof import("../src/config/env"))["env"];

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type RecordedRequest = { method?: string; url?: string; contentType?: string };

let fakeS3: http.Server;
let fakeS3Port: number;
let fakeS3Requests: RecordedRequest[];

before(async () => {
  const configModule = await import("../src/config/env");
  env = configModule.env;
  storage = await import("../src/storage/private-storage");

  fakeS3Requests = [];
  fakeS3 = http.createServer((req, res) => {
    req.on("end", () => {
      fakeS3Requests.push({
        method: req.method,
        url: req.url,
        contentType: req.headers["content-type"]
      });
      res.writeHead(200, { etag: '"fake"' });
      res.end();
    });
    req.resume();
  });
  await new Promise<void>((resolve) => fakeS3.listen(0, "127.0.0.1", resolve));
  fakeS3Port = (fakeS3.address() as { port: number }).port;
});

after(async () => {
  storage.resetPrivateStorageProvider();
  await new Promise<void>((resolve) => fakeS3.close(() => resolve()));
});

test("in-memory storage (development/test default) stores and issues opaque temporary references", async () => {
  storage.resetPrivateStorageProvider();

  const uploaded = await storage.uploadPrivateFile("prescriptions", {
    extension: ".pdf",
    contentType: "application/pdf",
    body: Buffer.from("test-bytes")
  });

  assert.ok(uploaded.key.startsWith("prescriptions/"));
  assert.ok(uploaded.key.endsWith(".pdf"));
  // Object keys are server-generated: no client-supplied path segments.
  assert.ok(!uploaded.key.includes(".."));

  const access = await storage.createPrivateTemporaryAccess(uploaded.key);
  assert.ok(access.reference.startsWith("private://"));
  const expectedSeconds = env.STORAGE_SIGNED_URL_EXPIRY_SECONDS;
  const deltaSeconds = (access.expiresAt.getTime() - Date.now()) / 1000;
  assert.ok(deltaSeconds > expectedSeconds - 5 && deltaSeconds <= expectedSeconds);
});

test("in-memory storage explicit expiry and deletion behavior", async () => {
  storage.resetPrivateStorageProvider();

  const uploaded = await storage.uploadPrivateFile("lab-reports", {
    extension: ".png",
    contentType: "image/png",
    body: Buffer.from("report")
  });

  const access = await storage.createPrivateTemporaryAccess(uploaded.key, 120);
  const deltaSeconds = (access.expiresAt.getTime() - Date.now()) / 1000;
  assert.ok(deltaSeconds > 115 && deltaSeconds <= 120);

  await storage.deletePrivateObject(uploaded.key);
  await assert.rejects(
    () => storage.createPrivateTemporaryAccess(uploaded.key),
    (error: unknown) =>
      error instanceof AppError && error.statusCode === 502 && error.code === "STORAGE_ACCESS_FAILED"
  );
});

test("upload failures surface as STORAGE_UPLOAD_FAILED (502)", async () => {
  storage.setPrivateStorageProvider({
    upload: async () => {
      throw new Error("provider down");
    },
    delete: async () => {}
  });

  await assert.rejects(
    () =>
      storage.uploadPrivateFile("prescriptions", {
        extension: ".pdf",
        contentType: "application/pdf",
        body: Buffer.from("x")
      }),
    (error: unknown) =>
      error instanceof AppError && error.statusCode === 502 && error.code === "STORAGE_UPLOAD_FAILED"
  );
});

test("temporary access is unavailable for providers without temporary-access support (503)", async () => {
  storage.setPrivateStorageProvider({
    upload: async (input) => ({ key: input.key }),
    delete: async () => {}
  });

  await assert.rejects(
    () => storage.createPrivateTemporaryAccess("prescriptions/whatever.pdf"),
    (error: unknown) =>
      error instanceof AppError && error.statusCode === 503 && error.code === "STORAGE_ACCESS_UNAVAILABLE"
  );
});

test("S3 adapter uploads privately (PUT) and deletes (DELETE) without any public exposure", async () => {
  fakeS3Requests = [];
  const s3 = new S3PrivateStorage({
    bucket: "oncoeasy-private-test",
    region: "us-east-1",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    endpoint: `http://127.0.0.1:${fakeS3Port}`,
    forcePathStyle: true
  });

  const uploaded = await s3.upload({
    key: "prescriptions/server-generated-key.pdf",
    contentType: "application/pdf",
    body: Buffer.from("pdf-bytes")
  });
  assert.equal(uploaded.key, "prescriptions/server-generated-key.pdf");

  await s3.delete("prescriptions/server-generated-key.pdf");

  assert.equal(fakeS3Requests.length, 2);
  assert.equal(fakeS3Requests[0].method, "PUT");
  assert.ok(fakeS3Requests[0].url?.startsWith("/oncoeasy-private-test/prescriptions/server-generated-key.pdf"));
  assert.equal(fakeS3Requests[0].contentType, "application/pdf");
  assert.equal(fakeS3Requests[1].method, "DELETE");
  assert.ok(fakeS3Requests[1].url?.startsWith("/oncoeasy-private-test/prescriptions/server-generated-key.pdf"));
});

test("S3 adapter temporary access is a short-lived presigned GET URL computed without network calls", async () => {
  fakeS3Requests = [];
  const s3 = new S3PrivateStorage({
    bucket: "oncoeasy-private-test",
    region: "us-east-1",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    endpoint: `http://127.0.0.1:${fakeS3Port}`,
    forcePathStyle: true
  });

  const access = await s3.createTemporaryAccess("prescriptions/server-generated-key.pdf", 120);

  assert.ok(access.reference.includes("/oncoeasy-private-test/prescriptions/server-generated-key.pdf"));
  assert.ok(access.reference.includes("X-Amz-Algorithm=AWS4-HMAC-SHA256"));
  assert.ok(access.reference.includes("X-Amz-Expires=120"));
  assert.ok(access.reference.includes("X-Amz-Signature="));
  const deltaSeconds = (access.expiresAt.getTime() - Date.now()) / 1000;
  assert.ok(deltaSeconds > 115 && deltaSeconds <= 120);

  // Presigning is local: no HTTP request was made to the (fake) endpoint.
  assert.equal(fakeS3Requests.length, 0);
});

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
  JWT_REFRESH_EXPIRES_IN: "7d"
};

test("development/test keeps working with in-memory storage and no cloud credentials", async () => {
  const result = await runEnvProcess({ NODE_ENV: "development", STORAGE_PROVIDER: "in-memory" });
  assert.equal(result.code, 0);
});

test("production rejects in-memory storage with a clear message", async () => {
  const result = await runEnvProcess({ ...baseProductionEnv, STORAGE_PROVIDER: "in-memory" });
  assert.equal(result.code, 1);
  assert.ok(result.output.includes("STORAGE_PROVIDER=in-memory must not be used in production"));
});

test("production s3 storage fails clearly when required credentials are missing", async () => {
  const result = await runEnvProcess({ ...baseProductionEnv, STORAGE_PROVIDER: "s3" });
  assert.equal(result.code, 1);
  for (const variable of ["STORAGE_BUCKET", "STORAGE_REGION", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"]) {
    assert.ok(result.output.includes(`${variable} is required when STORAGE_PROVIDER is s3`));
  }
});

test("production s3-compatible storage requires an explicit endpoint", async () => {
  const result = await runEnvProcess({
    ...baseProductionEnv,
    STORAGE_PROVIDER: "s3-compatible",
    STORAGE_BUCKET: "bucket",
    STORAGE_REGION: "us-east-1",
    STORAGE_ACCESS_KEY_ID: "ak",
    STORAGE_SECRET_ACCESS_KEY: "sk"
  });
  assert.equal(result.code, 1);
  assert.ok(result.output.includes("STORAGE_ENDPOINT is required when STORAGE_PROVIDER is s3-compatible"));
});

test("production accepts fully configured s3 storage (values parsed, no network calls)", async () => {
  const result = await runEnvProcess({
    ...baseProductionEnv,
    STORAGE_PROVIDER: "s3",
    STORAGE_BUCKET: "oncoeasy-private",
    STORAGE_REGION: "ap-south-1",
    STORAGE_ACCESS_KEY_ID: "dummy-access-key",
    STORAGE_SECRET_ACCESS_KEY: "dummy-secret-key",
    STORAGE_SIGNED_URL_EXPIRY_SECONDS: "300"
  });
  assert.equal(result.code, 0, `expected success, got: ${result.output}`);
});
