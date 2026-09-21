import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import dotenv from "dotenv";

dotenv.config({ override: true });
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME?schema=public";
process.env.JWT_ACCESS_SECRET ??= "integration-test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "integration-test-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.JWT_REFRESH_EXPIRES_IN ??= "7d";

let server: Server;
let baseUrl: string;
let categoryIds: string[];
let productIds: string[];
const testKey = `phase175-${Date.now()}`;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");

  const activeCategory = await prisma.productCategory.create({
    data: { name: `${testKey} Active`, slug: `${testKey}-active` }
  });
  const secondCategory = await prisma.productCategory.create({
    data: { name: `${testKey} Second`, slug: `${testKey}-second` }
  });
  const inactiveCategory = await prisma.productCategory.create({
    data: { name: `${testKey} Inactive`, slug: `${testKey}-inactive`, isActive: false }
  });
  categoryIds = [activeCategory.id, secondCategory.id, inactiveCategory.id];

  const products = await Promise.all([
    prisma.product.create({
      data: {
        sku: `${testKey}-RX`,
        name: `${testKey} Prescription`,
        categoryId: activeCategory.id,
        price: "125.50",
        currency: "INR",
        prescriptionRequired: true
      }
    }),
    prisma.product.create({
      data: {
        sku: `${testKey}-COLD`,
        name: `${testKey} Cold Chain`,
        categoryId: activeCategory.id,
        price: "99.99",
        currency: "INR",
        coldChainRequired: true,
        temperatureMinC: "2.00",
        temperatureMaxC: "8.00"
      }
    }),
    prisma.product.create({
      data: {
        sku: `${testKey}-SECOND`,
        name: `${testKey} Second Category`,
        categoryId: secondCategory.id,
        price: "10.00",
        currency: "INR"
      }
    }),
    prisma.product.create({
      data: {
        sku: `${testKey}-OFF`,
        name: `${testKey} Inactive`,
        categoryId: activeCategory.id,
        price: "10.00",
        currency: "INR",
        isActive: false
      }
    })
  ]);
  productIds = products.map((product) => product.id);

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
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.productCategory.deleteMany({ where: { id: { in: categoryIds } } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("returns active categories in the standard envelope", async () => {
  const response = await get("/api/v1/pharmacy/categories");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.some((category: { slug: string }) => category.slug === `${testKey}-active`), true);
  assert.equal(body.data.some((category: { slug: string }) => category.slug === `${testKey}-inactive`), false);
  assert.deepEqual(Object.keys(body.data.find((category: { slug: string }) => category.slug === `${testKey}-active`)).sort(), ["id", "name", "slug"]);
});

test("lists active products with pagination and public fields", async () => {
  const response = await get(`/api/v1/pharmacy/products?category=${testKey}-active&page=1&pageSize=1`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.items.length, 1);
  assert.equal(body.data.pagination.total, 2);
  assert.equal(body.data.pagination.totalPages, 2);
  assert.equal(body.data.items[0].price, "99.99");
  assert.deepEqual(Object.keys(body.data.items[0]).sort(), [
    "category", "coldChainDeliveryEligible", "coldChainRequired", "currency", "description",
    "id", "minimumQuantity", "name", "price", "prescriptionRequired", "regularDeliveryEligible",
    "sku", "temperatureMaxC", "temperatureMinC", "unitLabel"
  ].sort());
});

test("enforces the maximum page size", async () => {
  const response = await get(`/api/v1/pharmacy/products?pageSize=101`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.equal(body.error.code, "VALIDATION_ERROR");
});

test("supports name and SKU search", async () => {
  const nameResponse = await get(`/api/v1/pharmacy/products?search=${testKey.toUpperCase()}%20PRESCRIPTION`);
  const skuResponse = await get(`/api/v1/pharmacy/products?search=${testKey}-RX`);

  assert.equal((await nameResponse.json()).data.items.length, 1);
  assert.equal((await skuResponse.json()).data.items[0].sku, `${testKey}-RX`);
});

test("supports category, prescription, and cold-chain filters", async () => {
  const categoryResponse = await get(`/api/v1/pharmacy/products?category=${testKey}-second`);
  const prescriptionResponse = await get("/api/v1/pharmacy/products?prescriptionRequired=true");
  const coldChainResponse = await get("/api/v1/pharmacy/products?coldChainRequired=true");

  assert.equal((await categoryResponse.json()).data.items[0].sku, `${testKey}-SECOND`);
  assert.equal((await prescriptionResponse.json()).data.items[0].sku, `${testKey}-RX`);
  assert.equal((await coldChainResponse.json()).data.items[0].sku, `${testKey}-COLD`);
});

test("returns active product details and hides inactive or missing products", async () => {
  const activeResponse = await get(`/api/v1/pharmacy/products/${productIds[0]}`);
  const inactiveResponse = await get(`/api/v1/pharmacy/products/${productIds[3]}`);
  const missingResponse = await get("/api/v1/pharmacy/products/550e8400-e29b-41d4-a716-446655440000");

  assert.equal(activeResponse.status, 200);
  assert.equal((await activeResponse.json()).data.sku, `${testKey}-RX`);
  assert.equal(inactiveResponse.status, 404);
  assert.equal((await inactiveResponse.json()).error.code, "PRODUCT_NOT_FOUND");
  assert.equal(missingResponse.status, 404);
  assert.equal((await missingResponse.json()).error.code, "PRODUCT_NOT_FOUND");
});

test("rejects invalid UUIDs and query parameters", async () => {
  const uuidResponse = await get("/api/v1/pharmacy/products/not-a-uuid");
  const queryResponse = await get("/api/v1/pharmacy/products?page=0&prescriptionRequired=maybe");

  assert.equal(uuidResponse.status, 400);
  assert.equal(queryResponse.status, 400);
  assert.equal((await uuidResponse.json()).error.code, "VALIDATION_ERROR");
  assert.equal((await queryResponse.json()).error.code, "VALIDATION_ERROR");
});

async function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}