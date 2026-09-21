import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { UserRole } from "@prisma/client";
import * as XLSX from "xlsx";
import dotenv from "dotenv";

dotenv.config({ override: true });
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME?schema=public";
process.env.JWT_ACCESS_SECRET ??= "integration-test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "integration-test-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.JWT_REFRESH_EXPIRES_IN ??= "7d";

const columns = [
  "sku", "name", "description", "category", "price", "currency", "unitLabel",
  "prescriptionRequired", "coldChainRequired", "temperatureMinC", "temperatureMaxC",
  "minimumQuantity", "regularDeliveryEligible", "coldChainDeliveryEligible", "isActive"
];
let server: Server;
let baseUrl: string;
let categoryId: string;
let pharmacistId: string;
let adminId: string;
let patientId: string;
let doctorId: string;
const testKey = `phase1713-${Date.now()}`;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");
  const category = await prisma.productCategory.create({ data: { name: `${testKey} Category`, slug: `${testKey}-category` } });
  categoryId = category.id;
  const users = await Promise.all([
    createUser(prisma, "pharmacist", UserRole.PHARMACIST),
    createUser(prisma, "admin", UserRole.OPS_ADMIN),
    createUser(prisma, "patient", UserRole.PATIENT),
    createUser(prisma, "doctor", UserRole.DOCTOR)
  ]);
  [pharmacistId, adminId, patientId, doctorId] = users.map((user) => user.id);
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
  await prisma.productImportJob.deleteMany({ where: { createdByUserId: { in: [pharmacistId, adminId] } } });
  await prisma.product.deleteMany({ where: { categoryId } });
  await prisma.product.deleteMany({ where: { sku: { startsWith: testKey } } });
  await prisma.user.deleteMany({ where: { id: { in: [pharmacistId, adminId, patientId, doctorId] } } });
  await prisma.productCategory.delete({ where: { id: categoryId } });
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("enforces importer roles", async () => {
  const path = "/api/v1/pharmacy/imports/products";
  const unauthenticated = await upload(path);
  const patient = await upload(path, await tokenFor(patientId));
  const doctor = await upload(path, await tokenFor(doctorId, UserRole.DOCTOR));
  const pharmacist = await upload(path, await tokenFor(pharmacistId, UserRole.PHARMACIST), workbook([validRow("ROLE")]));
  const admin = await upload(path, await tokenFor(adminId, UserRole.OPS_ADMIN), workbook([validRow("ADMIN")]));

  assert.equal(unauthenticated.status, 401);
  assert.equal(patient.status, 403);
  assert.equal(doctor.status, 403);
  assert.equal(pharmacist.status, 201);
  assert.equal(admin.status, 201);
});

test("persists valid rows, updates by SKU, and reports invalid rows", async () => {
  const { prisma } = await import("../src/database/prisma");
  await prisma.product.create({ data: { sku: `${testKey}-UPDATE`, name: "Before", categoryId, price: "1.00", currency: "INR" } });
  const response = await upload(
    "/api/v1/pharmacy/imports/products",
    await tokenFor(pharmacistId, UserRole.PHARMACIST),
    workbook([
      validRow(`${testKey}-CREATE`, "Created", "12.34"),
      validRow(`${testKey}-UPDATE`, "Updated", "99.99"),
      validRow("INVALID", "Invalid", "not-a-price", "unknown-category")
    ])
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.data.status, "COMPLETED_WITH_ERRORS", JSON.stringify(response.body));
  assert.equal(response.body.data.totalRows, 3, JSON.stringify(response.body));
  assert.equal(response.body.data.validRows, 2, JSON.stringify(response.body));
  assert.equal(response.body.data.invalidRows, 1, JSON.stringify(response.body));
  assert.equal(response.body.data.createdProducts, 1, JSON.stringify(response.body));
  assert.equal(response.body.data.updatedProducts, 1, JSON.stringify(response.body));
  assert.equal(response.body.data.errors.some((error: { rowNumber: number }) => error.rowNumber === 4), true, JSON.stringify(response.body));

  const created = await prisma.product.findUnique({ where: { sku: `${testKey}-CREATE` } });
  const updated = await prisma.product.findUnique({ where: { sku: `${testKey}-UPDATE` } });
  assert.equal(created?.price.toFixed(2), "12.34", JSON.stringify({ created, response: response.body }));
  assert.equal(updated?.name, "Updated", JSON.stringify({ updated, response: response.body }));
  assert.equal(await prisma.product.count({ where: { sku: `${testKey}-UPDATE` } }), 1);
});

test("duplicate SKUs remain invalid and history APIs are protected", async () => {
  const duplicateResponse = await upload(
    "/api/v1/pharmacy/imports/products",
    await tokenFor(pharmacistId, UserRole.PHARMACIST),
    workbook([validRow("DUPLICATE"), validRow("DUPLICATE")])
  );
  assert.equal(duplicateResponse.status, 201);
  assert.equal(duplicateResponse.body.data.status, "COMPLETED_WITH_ERRORS");
  assert.equal(duplicateResponse.body.data.createdProducts, 0);
  assert.equal(duplicateResponse.body.data.invalidRows, 2);

  const list = await request("GET", "/api/v1/pharmacy/imports/products", await tokenFor(adminId, UserRole.OPS_ADMIN));
  const patient = await request("GET", "/api/v1/pharmacy/imports/products", await tokenFor(patientId));
  const detail = await request("GET", `/api/v1/pharmacy/imports/products/${duplicateResponse.body.data.importJobId}`, await tokenFor(pharmacistId, UserRole.PHARMACIST));

  assert.equal(list.status, 200);
  assert.equal(list.body.data.items.length >= 1, true);
  assert.equal(patient.status, 403);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.rows.length, 2);
  assert.equal(detail.body.data.rows.every((row: { status: string }) => row.status === "INVALID"), true);
});

test("rejects missing, unsupported, and malformed workbooks", async () => {
  const path = "/api/v1/pharmacy/imports/products";
  const missing = await upload(path, await tokenFor(pharmacistId, UserRole.PHARMACIST), null);
  const unsupported = await upload(path, await tokenFor(pharmacistId, UserRole.PHARMACIST), Buffer.from("not xlsx"), "products.csv");
  const malformed = await upload(path, await tokenFor(pharmacistId, UserRole.PHARMACIST), Buffer.from("not xlsx"), "products.xlsx");

  assert.equal(missing.status, 400, JSON.stringify(missing.body));
  assert.equal(missing.body.error.code, "FILE_REQUIRED", JSON.stringify(missing.body));
  assert.equal(unsupported.status, 400, JSON.stringify(unsupported.body));
  assert.equal(malformed.status, 400, JSON.stringify(malformed.body));
  assert.equal(malformed.body.error.code, "IMPORT_FILE_INVALID", JSON.stringify(malformed.body));
});

function validRow(sku: string, name = "Product", price = "10.00", category = `${testKey}-category`) {
  return [sku, name, "Description", category, price, "INR", "box", "false", "false", "", "", "1", "true", "false", "true"];
}

function workbook(rows: unknown[][]) {
  const sheet = XLSX.utils.aoa_to_sheet([columns, ...rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Products");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function createUser(prisma: typeof import("../src/database/prisma").prisma, name: string, role: UserRole) {
  return prisma.user.create({ data: { fullName: `${testKey} ${name}`, email: `${testKey}-${name}@example.com`, phone: `+1555${String(Math.floor(Math.random() * 1_000_0000)).padStart(7, "0")}`, role, isVerified: true } });
}

async function tokenFor(userId: string, role = UserRole.PATIENT) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function upload(path: string, token?: string, file: Buffer | null = workbook([validRow("DEFAULT")]), fileName = "products.xlsx") {
  const form = new FormData();
  if (file !== null) form.append("file", new Blob([file]), fileName);
  return request("POST", path, token, form);
}

async function request(method: string, path: string, token?: string, body?: BodyInit) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : undefined, body });
  return { status: response.status, body: (await response.json()) as any };
}