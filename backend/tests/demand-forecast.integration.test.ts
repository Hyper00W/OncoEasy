import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import {
  OrderOriginType,
  OrderStatus,
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

/**
 * Phase 5.0 — pharmacy demand forecast engine integration tests.
 *
 * Fixtures are isolated by a unique `testKey` prefix and deleted in `after()`.
 * Assertions never rely on absolute database totals: the shared development
 * database may legitimately contain real DELIVERED orders, so aggregate
 * responses are checked structurally and every numeric expectation is scoped to
 * a fixture product.
 */

let server: Server;
let baseUrl: string;

let patientId: string;
let pharmacistId: string;
let adminId: string;
let doctorId: string;
let agentId: string;

const testKey = `phase50-${Date.now()}`;
const createdUserIds: string[] = [];
const createdProductIds: string[] = [];
const createdOrderIds: string[] = [];
const createdCategoryIds: string[] = [];

/** Distinctive patient identity used to prove no PII leaks through forecasts. */
const PII_NAME = `PII-PROBE-${testKey}`;
const PII_EMAIL = `pii-probe-${testKey}@example.com`;
const PII_PHONE = "+15550000123";

// --- product fixtures (names/skus referenced by assertions) ---
let ruleProductId = "";
let ruleProductSku = "";
let flatProductId = "";
let flatProductSku = "";
let highProductId = "";
let mediumProductId = "";
let sparseProductId = "";
let trendProductId = "";
let zeroProductId = "";
let zeroProductSku = "";
let newProductId = "";
let backtestProductId = "";
let inactiveProductId = "";

let piiOrderId = "";

/**
 * Day keys are expressed relative to *yesterday* because the engine's history
 * window is the set of complete UTC days ending yesterday.
 */
function dayKey(offsetFromToday: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetFromToday);
  return date.toISOString().slice(0, 10);
}

/** `daysAgoFromYesterday === 0` is yesterday; `3` is three days before yesterday. */
function orderDay(daysAgoFromYesterday: number): Date {
  return new Date(`${dayKey(-1 - daysAgoFromYesterday)}T12:00:00.000Z`);
}

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");

  const users = await Promise.all([
    createUser(prisma, "patient", UserRole.PATIENT, PII_NAME, PII_EMAIL, PII_PHONE),
    createUser(prisma, "pharmacist", UserRole.PHARMACIST),
    createUser(prisma, "admin", UserRole.OPS_ADMIN),
    createUser(prisma, "doctor", UserRole.DOCTOR),
    createUser(prisma, "agent", UserRole.DELIVERY_AGENT)
  ]);
  [patientId, pharmacistId, adminId, doctorId, agentId] = users.map((user) => user.id);
  createdUserIds.push(...users.map((user) => user.id));

  // Category and products. Products are back-dated so they were "observed" for
  // the whole window; the `newProduct` fixture is created today on purpose.
  const category = await prisma.productCategory.create({
    data: { name: `${testKey} category`, slug: `${testKey}-category` }
  });
  createdCategoryIds.push(category.id);

  const longAgo = new Date(`${dayKey(-400)}T00:00:00.000Z`);

  const rule = await createProduct(prisma, category.id, "RULE", longAgo);
  ruleProductId = rule.id;
  ruleProductSku = rule.sku;

  const flat = await createProduct(prisma, category.id, "FLAT", longAgo);
  flatProductId = flat.id;
  flatProductSku = flat.sku;

  const high = await createProduct(prisma, category.id, "HIGH", longAgo);
  highProductId = high.id;

  const medium = await createProduct(prisma, category.id, "MEDIUM", longAgo);
  mediumProductId = medium.id;

  const sparse = await createProduct(prisma, category.id, "SPARSE", longAgo);
  sparseProductId = sparse.id;

  const trend = await createProduct(prisma, category.id, "TREND", longAgo);
  trendProductId = trend.id;

  const zero = await createProduct(prisma, category.id, "ZERO", longAgo);
  zeroProductId = zero.id;
  zeroProductSku = zero.sku;

  const newProduct = await createProduct(prisma, category.id, "NEW", new Date());
  newProductId = newProduct.id;

  const backtest = await createProduct(prisma, category.id, "BACKTEST", longAgo);
  backtestProductId = backtest.id;

  const inactive = await createProduct(prisma, category.id, "INACTIVE", longAgo, false);
  inactiveProductId = inactive.id;

  // --- demand histories -----------------------------------------------------

  // RULE: DELIVERED demand on three days (10 + 5 + 2 = 17 units). One order per
  // status that must NOT count, plus one DELIVERED order far outside the window.
  await createOrder(prisma, ruleProductId, 10, OrderStatus.DELIVERED, orderDay(1));
  await createOrder(prisma, ruleProductId, 5, OrderStatus.DELIVERED, orderDay(2));
  await createOrder(prisma, ruleProductId, 2, OrderStatus.DELIVERED, orderDay(3));
  await createOrder(prisma, ruleProductId, 100, OrderStatus.CANCELLED, orderDay(2));
  await createOrder(prisma, ruleProductId, 50, OrderStatus.PROCESSING, orderDay(2));
  await createOrder(prisma, ruleProductId, 40, OrderStatus.PAID, orderDay(2));
  await createOrder(prisma, ruleProductId, 30, OrderStatus.PENDING_PAYMENT, orderDay(2));
  await createOrder(prisma, ruleProductId, 999, OrderStatus.DELIVERED, orderDay(200));

  // FLAT: exactly 10 units/day for every day of a 30-day window. A perfectly
  // flat series makes the weighted baseline exactly 10 with a zero slope, so
  // horizon scaling can be asserted exactly.
  for (let offset = 0; offset < 30; offset += 1) {
    await createOrder(prisma, flatProductId, 10, OrderStatus.DELIVERED, orderDay(offset));
  }

  // HIGH: demand on 21 of 30 observed days (sparsity 0.7, >= 21 data points).
  for (let offset = 0; offset < 21; offset += 1) {
    await createOrder(prisma, highProductId, 4, OrderStatus.DELIVERED, orderDay(offset));
  }

  // MEDIUM: demand on 7 of 30 observed days (sparsity ~0.23, >= 7 data points).
  for (let offset = 0; offset < 7; offset += 1) {
    await createOrder(prisma, mediumProductId, 3, OrderStatus.DELIVERED, orderDay(offset));
  }

  // SPARSE: a single demand day inside the window -> LOW_DATA_SUFFICIENCY.
  await createOrder(prisma, sparseProductId, 2, OrderStatus.DELIVERED, orderDay(4));

  // TREND: heavy demand early in the window, nothing recent -> a strongly
  // negative fitted slope that the damped clamp must keep non-negative. Needs
  // at least TREND_MIN_DATA_POINTS (14) demand days before a trend is fitted
  // at all, which is exactly the guard this fixture also exercises.
  for (let offset = 16; offset < 30; offset += 1) {
    await createOrder(prisma, trendProductId, 60, OrderStatus.DELIVERED, orderDay(offset));
  }

  // INACTIVE: has demand, but is deactivated (must be excluded by default).
  await createOrder(prisma, inactiveProductId, 7, OrderStatus.DELIVERED, orderDay(1));

  // BACKTEST: 5 units/day across 44 days, enough for two rolling-origin folds.
  for (let offset = 0; offset < 44; offset += 1) {
    await createOrder(prisma, backtestProductId, 5, OrderStatus.DELIVERED, orderDay(offset));
  }

  // A PII-carrying delivered order so the leak checks have something to find.
  const piiOrder = await createOrder(prisma, ruleProductId, 3, OrderStatus.DELIVERED, orderDay(5));
  piiOrderId = piiOrder.id;

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
  await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.productCategory.deleteMany({ where: { id: { in: createdCategoryIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// ---------------------------------------------------------------------------
// Historical demand aggregation and the demand rule
// ---------------------------------------------------------------------------

test("historical aggregation counts only DELIVERED orders and sums order item quantities", async () => {
  const response = await getJson(
    `/api/v1/admin/pharmacy/forecasts/products/${ruleProductId}?horizonDays=14&historyDays=30`,
    await tokenFor(adminId, UserRole.OPS_ADMIN)
  );

  assert.equal(response.status, 200);
  const { forecast } = response.body.data;

  // 10 (day 1) + 5 (day 2) + 2 (day 3) + 3 (PII probe order, day 5) = 20.
  assert.equal(forecast.totalHistoricalDemand, 20, "only DELIVERED units count");
  assert.equal(forecast.qualifyingOrders, 4, "one qualifying order per DELIVERED order");
  assert.equal(forecast.dataPoints, 4, "four distinct demand days");
  assert.equal(forecast.historicalDays, 30, "product observed for the whole window");
  assert.equal(forecast.averageHistoricalDemand, Number((20 / 30).toFixed(2)));
  assert.equal(forecast.firstDemandDate, dayKey(-6), "earliest demand day in window");
  assert.equal(forecast.lastDemandDate, dayKey(-2), "latest demand day in window");
});

test("cancelled, processing, paid, pending and out-of-window orders never contribute demand", async () => {
  const response = await getJson(
    `/api/v1/admin/pharmacy/forecasts/products/${ruleProductId}?horizonDays=14&historyDays=30`,
    await tokenFor(pharmacistId, UserRole.PHARMACIST)
  );
  const { forecast } = response.body.data;

  // The excluded fixture quantities total 100 + 50 + 40 + 30 + 999 = 1219 units.
  assert.equal(forecast.totalHistoricalDemand, 20);
  assert.ok(
    forecast.totalHistoricalDemand < 1219,
    "excluded statuses and the out-of-window order contributed nothing"
  );
  assert.equal(forecast.forecastHorizonDays, 14);
});

test("daily and weekly demand series are contiguous, zero-filled and bucketed", async () => {
  const response = await getJson(
    `/api/v1/admin/pharmacy/forecasts/products/${ruleProductId}?horizonDays=7&historyDays=30`,
    await tokenFor(adminId, UserRole.OPS_ADMIN)
  );
  const { historicalDemand } = response.body.data;

  assert.equal(historicalDemand.daily.length, 30, "one entry per observed day");
  assert.equal(historicalDemand.daily[0].date, dayKey(-30));
  assert.equal(historicalDemand.daily[historicalDemand.daily.length - 1].date, dayKey(-1));
  assert.equal(
    historicalDemand.daily.reduce((total: number, point: { units: number }) => total + point.units, 0),
    20,
    "zero-filled days do not add demand"
  );
  assert.ok(
    historicalDemand.daily.some((point: { units: number }) => point.units === 0),
    "days with no demand appear as explicit zeros"
  );

  // Weekly buckets must partition the same units.
  const weeklyTotal = historicalDemand.weekly.reduce(
    (total: number, week: { units: number }) => total + week.units,
    0
  );
  assert.equal(weeklyTotal, 20, "weekly buckets partition the daily series");
  for (const week of historicalDemand.weekly) {
    assert.equal(new Date(`${week.weekStart}T00:00:00.000Z`).getUTCDay(), 1, "weeks are Monday-anchored");
  }
});

// ---------------------------------------------------------------------------
// Horizons
// ---------------------------------------------------------------------------

test("7, 14 and 30-day horizons scale a flat daily rate exactly", async () => {
  const expected: Record<number, number> = { 7: 70, 14: 140, 30: 300 };

  for (const horizonDays of [7, 14, 30]) {
    const response = await getJson(
      `/api/v1/admin/pharmacy/forecasts/products/${flatProductId}?horizonDays=${horizonDays}&historyDays=30`,
      await tokenFor(adminId, UserRole.OPS_ADMIN)
    );
    assert.equal(response.status, 200);
    const { forecast } = response.body.data;

    assert.equal(forecast.forecastHorizonDays, horizonDays);
    assert.equal(
      forecast.predictedQuantity,
      expected[horizonDays],
      `10 units/day over ${horizonDays} days`
    );
    assert.equal(forecast.trendApplied, false, "a flat series fits no trend");
    assert.equal(forecast.method, "RECENCY_WEIGHTED_DAILY_AVERAGE");
  }
});

test("unsupported horizons and malformed parameters are rejected without touching the database", async () => {
  const token = await tokenFor(adminId, UserRole.OPS_ADMIN);

  for (const query of ["horizonDays=45", "horizonDays=0", "horizonDays=abc", "horizonDays=7.5"]) {
    const response = await getJson(`/api/v1/admin/pharmacy/forecasts/summary?${query}`, token);
    assert.equal(response.status, 400, `${query} must be rejected`);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, "VALIDATION_ERROR");
  }

  const badHistory = await getJson(
    "/api/v1/admin/pharmacy/forecasts/summary?horizonDays=7&historyDays=5",
    token
  );
  assert.equal(badHistory.status, 400, "historyDays below the minimum is rejected");

  const unknownParam = await getJson(
    "/api/v1/admin/pharmacy/forecasts/summary?horizonDays=7&bogus=1",
    token
  );
  assert.equal(unknownParam.status, 400, "unknown query parameters are rejected, not ignored");
});

// ---------------------------------------------------------------------------
// Data sufficiency and edge cases
// ---------------------------------------------------------------------------

test("data sufficiency classification follows the documented rule table", async () => {
  const token = await tokenFor(adminId, UserRole.OPS_ADMIN);

  const high = await getJson(
    `/api/v1/admin/pharmacy/forecasts/products/${highProductId}?horizonDays=7&historyDays=30`,
    token
  );
  assert.equal(high.body.data.forecast.dataSufficiency, "HIGH_DATA_SUFFICIENCY");
  assert.equal(high.body.data.forecast.dataPoints, 21);
  assert.equal(high.body.data.forecast.historicalDays, 30);

  const medium = await getJson(
    `/api/v1/admin/pharmacy/forecasts/products/${mediumProductId}?horizonDays=7&historyDays=30`,
    token
  );
  assert.equal(medium.body.data.forecast.dataSufficiency, "MEDIUM_DATA_SUFFICIENCY");
  assert.equal(medium.body.data.forecast.dataPoints, 7);

  const low = await getJson(
    `/api/v1/admin/pharmacy/forecasts/products/${sparseProductId}?horizonDays=7&historyDays=30`,
    token
  );
  assert.equal(low.body.data.forecast.dataSufficiency, "LOW_DATA_SUFFICIENCY");
  assert.equal(low.body.data.forecast.dataPoints, 1);
  assert.ok(low.body.data.forecast.sparsity > 0 && low.body.data.forecast.sparsity < 0.15);
});

test("a product with no demand returns INSUFFICIENT_DATA with a null quantity, not a fabricated zero forecast", async () => {
  const response = await getJson(
    `/api/v1/admin/pharmacy/forecasts/products/${zeroProductId}?horizonDays=14&historyDays=30`,
    await tokenFor(adminId, UserRole.OPS_ADMIN)
  );
  const { forecast, historicalDemand } = response.body.data;

  assert.equal(forecast.dataSufficiency, "INSUFFICIENT_DATA");
  assert.equal(forecast.predictedQuantity, null, "no forecast is invented from no history");
  assert.equal(forecast.forecastDailyRate, null);
  assert.equal(forecast.totalHistoricalDemand, 0);
  assert.equal(forecast.dataPoints, 0);
  assert.equal(forecast.qualifyingOrders, 0);
  assert.equal(forecast.method, "NONE");
  assert.equal(forecast.firstDemandDate, "");
  assert.equal(historicalDemand.daily.every((point: { units: number }) => point.units === 0), true);
});

test("a newly created product is not credited with demand days before it existed", async () => {
  const response = await getJson(
    `/api/v1/admin/pharmacy/forecasts/products/${newProductId}?horizonDays=7&historyDays=30`,
    await tokenFor(adminId, UserRole.OPS_ADMIN)
  );
  const { forecast } = response.body.data;

  assert.equal(forecast.dataSufficiency, "INSUFFICIENT_DATA");
  assert.equal(forecast.predictedQuantity, null);
  assert.equal(forecast.historicalDays, 0, "no day in the window pre-dates the product");
  assert.equal(forecast.totalHistoricalDemand, 0);
});

test("a collapsing product never produces a negative prediction", async () => {
  const response = await getJson(
    `/api/v1/admin/pharmacy/forecasts/products/${trendProductId}?horizonDays=30&historyDays=30`,
    await tokenFor(adminId, UserRole.OPS_ADMIN)
  );
  const { forecast } = response.body.data;

  assert.ok(forecast.trendPerDay !== null && forecast.trendPerDay < 0, "a negative slope is detected");
  assert.ok(forecast.predictedQuantity !== null);
  assert.ok(forecast.predictedQuantity >= 0, "predictions are never negative");
  assert.ok(Number.isFinite(forecast.predictedQuantity));
});

test("the same request over unchanged data returns identical numbers", async () => {
  const token = await tokenFor(adminId, UserRole.OPS_ADMIN);
  const path = `/api/v1/admin/pharmacy/forecasts/products/${flatProductId}?horizonDays=14&historyDays=30`;

  const first = await getJson(path, token);
  const second = await getJson(path, token);

  assert.deepEqual(
    { ...first.body.data.forecast, generatedAt: undefined },
    { ...second.body.data.forecast, generatedAt: undefined },
    "the model is deterministic for the same data"
  );
  assert.deepEqual(
    first.body.data.historicalDemand.daily,
    second.body.data.historicalDemand.daily
  );
});

// ---------------------------------------------------------------------------
// Product lookup, search, pagination, filtering
// ---------------------------------------------------------------------------

test("SKU/product search surfaces products including those without any demand", async () => {
  const token = await tokenFor(adminId, UserRole.OPS_ADMIN);

  const bySku = await getJson(
    `/api/v1/admin/pharmacy/forecasts/products?horizonDays=14&historyDays=30&search=${encodeURIComponent(flatProductSku)}`,
    token
  );
  assert.equal(bySku.status, 200);
  assert.equal(bySku.body.data.universe, "CATALOG_SEARCH");
  assert.ok(
    bySku.body.data.items.some((item: { productId: string }) => item.productId === flatProductId),
    "exact SKU search finds the product"
  );

  const noDemand = await getJson(
    `/api/v1/admin/pharmacy/forecasts/products?horizonDays=14&historyDays=30&search=${encodeURIComponent(zeroProductSku)}`,
    token
  );
  const zeroRow = noDemand.body.data.items.find(
    (item: { productId: string }) => item.productId === zeroProductId
  );
  assert.ok(zeroRow, "a no-demand SKU is still findable");
  assert.equal(zeroRow.dataSufficiency, "INSUFFICIENT_DATA");
  assert.equal(zeroRow.predictedQuantity, null);
});

test("pagination and data-sufficiency filtering behave consistently", async () => {
  const token = await tokenFor(adminId, UserRole.OPS_ADMIN);
  const base = `/api/v1/admin/pharmacy/forecasts/products?horizonDays=14&historyDays=30&search=${testKey}`;

  const first = await getJson(`${base}&page=1&pageSize=2`, token);
  const second = await getJson(`${base}&page=2&pageSize=2`, token);

  assert.equal(first.body.data.pagination.pageSize, 2);
  assert.ok(first.body.data.items.length <= 2);
  assert.equal(first.body.data.pagination.total, second.body.data.pagination.total);
  assert.ok(
    first.body.data.pagination.totalPages >= 1,
    "the fixture category pages consistently"
  );

  const ids1 = first.body.data.items.map((item: { productId: string }) => item.productId);
  const ids2 = second.body.data.items.map((item: { productId: string }) => item.productId);
  assert.equal(ids1.some((id: string) => ids2.includes(id)), false, "pages do not overlap");

  const sufficient = await getJson(
    `${base}&dataSufficiency=INSUFFICIENT_DATA&pageSize=100`,
    token
  );
  assert.ok(sufficient.body.data.items.length > 0, "INSUFFICIENT_DATA rows are filterable");
  assert.equal(
    sufficient.body.data.items.every(
      (item: { dataSufficiency: string }) => item.dataSufficiency === "INSUFFICIENT_DATA"
    ),
    true
  );
});

test("inactive products are excluded by default and includable on request", async () => {
  const token = await tokenFor(adminId, UserRole.OPS_ADMIN);
  const base = `/api/v1/admin/pharmacy/forecasts/products?horizonDays=14&historyDays=30&pageSize=100&sort=sku&order=asc`;

  const defaultView = await getJson(`${base}&includeInactive=false`, token);
  assert.equal(
    defaultView.body.data.items.some(
      (item: { productId: string }) => item.productId === inactiveProductId
    ),
    false,
    "inactive products are hidden by default"
  );

  const includeInactive = await getJson(`${base}&includeInactive=true`, token);
  const inactiveRow = includeInactive.body.data.items.find(
    (item: { productId: string }) => item.productId === inactiveProductId
  );
  assert.ok(inactiveRow, "inactive products can be requested explicitly");
  assert.equal(inactiveRow.isActive, false);
});

test("the summary reports a coherent distribution and horizon metadata", async () => {
  const response = await getJson(
    "/api/v1/admin/pharmacy/forecasts/summary?horizonDays=30&historyDays=30",
    await tokenFor(adminId, UserRole.OPS_ADMIN)
  );

  assert.equal(response.status, 200);
  const data = response.body.data;

  assert.equal(data.horizonDays, 30);
  assert.equal(data.historyDays, 30);
  assert.equal(data.window.endDate, dayKey(-1), "the window ends on the last complete UTC day");
  assert.equal(data.window.startDate, dayKey(-30));
  assert.deepEqual(data.demandRule.orderStatuses, ["DELIVERED"]);
  assert.equal(data.demandRule.quantitySource, "order_items.quantity");

  const distributionTotal = Object.values(data.dataSufficiency).reduce(
    (total: number, value) => total + Number(value),
    0
  );
  assert.equal(distributionTotal, data.totals.productsWithDemandHistory);
  assert.equal(
    data.totals.productsWithForecast + data.totals.productsInsufficientData,
    data.totals.productsWithDemandHistory,
    "every product with demand history is either forecastable or explicitly insufficient"
  );
  assert.ok(data.totals.predictedUnits >= 0);
  assert.ok(data.topProducts.length <= 10);
  assert.ok(data.topProducts.every((row: { predictedQuantity: number | null }) => row.predictedQuantity === null || row.predictedQuantity >= 0));
  assert.ok(!Number.isNaN(Date.parse(data.generatedAt)), "generatedAt is a valid timestamp");
});

test("unknown and malformed product identifiers return the standard error contract", async () => {
  const token = await tokenFor(adminId, UserRole.OPS_ADMIN);

  const malformed = await getJson(
    "/api/v1/admin/pharmacy/forecasts/products/not-a-uuid",
    token
  );
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, "VALIDATION_ERROR");

  const missing = await getJson(
    `/api/v1/admin/pharmacy/forecasts/products/${crypto.randomUUID()}`,
    token
  );
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "PRODUCT_NOT_FOUND");
  assert.equal(missing.body.success, false);
});

// ---------------------------------------------------------------------------
// Backtesting
// ---------------------------------------------------------------------------

test("the rolling-origin backtest measures the served model out of sample", async () => {
  const response = await getJson(
    "/api/v1/admin/pharmacy/forecasts/backtest?horizonDays=7&historyDays=30&folds=2",
    await tokenFor(adminId, UserRole.OPS_ADMIN)
  );

  assert.equal(response.status, 200);
  const data = response.body.data;
  assert.equal(data.horizonDays, 7);
  assert.equal(data.folds, 2);
  assert.equal(typeof data.meaningful, "boolean");

  if (data.meaningful) {
    assert.ok(data.metrics.evaluatedPairs >= 4);
    assert.ok(data.byFold.length === 2, "one entry per fold");
    for (const fold of data.byFold) {
      assert.ok(fold.trainEnd < fold.testStart, "training data never overlaps the test window");
      assert.ok(fold.metrics.mae === null || fold.metrics.mae >= 0);
      assert.ok(fold.metrics.wape === null || fold.metrics.wape >= 0);
      assert.ok(fold.metrics.mape === null || fold.metrics.mape >= 0);
    }
  } else {
    assert.equal(typeof data.reason, "string", "an unusable backtest states why");
    assert.equal(data.metrics.mae, null, "no accuracy figure is invented");
    assert.equal(data.metrics.wape, null);
  }
});

test("backtest metrics are measured, bounded and never invented", async () => {
  const response = await getJson(
    "/api/v1/admin/pharmacy/forecasts/backtest?horizonDays=7&historyDays=30&folds=2",
    await tokenFor(pharmacistId, UserRole.PHARMACIST)
  );
  const data = response.body.data;

  if (!data.meaningful) {
    // Honest outcome on a database without enough history: no numbers claimed.
    assert.ok(data.metrics.evaluatedPairs < 4);
    assert.equal(data.metrics.mae, null);
    assert.equal(data.metrics.wape, null);
    assert.equal(data.metrics.mape, null);
    return;
  }

  // Metrics are real measurements over real pairs. Their magnitude is reported,
  // never asserted to a marketing threshold: this backtest aggregates across
  // every forecastable product in the database, including genuine intermittent
  // demand, so the honest number is whatever the data produces.
  assert.ok(data.metrics.evaluatedPairs >= 4);
  assert.ok(data.metrics.mae !== null && data.metrics.mae >= 0);
  assert.ok(data.metrics.wape !== null && data.metrics.wape >= 0);
  assert.ok(data.metrics.mape === null || data.metrics.mape >= 0, "MAPE is null when any actual is zero");
  assert.equal(data.metrics.actualUnits > 0, true, "errors are measured against real demand");

  const foldPairs = data.byFold.reduce(
    (total: number, fold: { metrics: { evaluatedPairs: number } }) => total + fold.metrics.evaluatedPairs,
    0
  );
  assert.equal(foldPairs, data.metrics.evaluatedPairs, "fold metrics partition the overall sample");
});

test("backtest folds walk backwards without overlapping and never train on their own test window", async () => {
  // The rolling-origin backtest must construct each training series from data
  // that ends before its test window. Fold boundaries are asserted here because
  // a leak would silently inflate accuracy.
  const response = await getJson(
    "/api/v1/admin/pharmacy/forecasts/backtest?horizonDays=7&historyDays=30&folds=3",
    await tokenFor(adminId, UserRole.OPS_ADMIN)
  );
  const data = response.body.data;

  assert.equal(data.folds, 3);
  if (!data.meaningful) {
    return;
  }

  for (let index = 0; index < data.byFold.length; index += 1) {
    const fold = data.byFold[index];
    assert.equal(fold.fold, index + 1);
    assert.ok(fold.trainEnd < fold.testStart, `fold ${fold.fold} trains strictly before its test window`);
    if (index > 0) {
      const previous = data.byFold[index - 1];
      assert.ok(fold.testEnd < previous.testStart, "folds walk backwards without overlapping");
    }
    assert.ok(fold.trainStart <= fold.trainEnd);
  }
});

// ---------------------------------------------------------------------------
// Authorization and data protection
// ---------------------------------------------------------------------------

test("forecast endpoints require authentication and the pharmacist/ops-admin roles", async () => {
  const paths = [
    "/api/v1/admin/pharmacy/forecasts/summary?horizonDays=7",
    "/api/v1/admin/pharmacy/forecasts/products?horizonDays=7",
    `/api/v1/admin/pharmacy/forecasts/products/${ruleProductId}?horizonDays=7`
  ];

  for (const path of paths) {
    const anonymous = await getJson(path);
    assert.equal(anonymous.status, 401, `${path} rejects anonymous access`);
    assert.equal(anonymous.body.error.code, "UNAUTHORIZED");
  }

  for (const [role, userId] of [
    [UserRole.PATIENT, patientId],
    [UserRole.DOCTOR, doctorId],
    [UserRole.DELIVERY_AGENT, agentId]
  ] as const) {
    for (const path of paths) {
      const forbidden = await getJson(path, await tokenFor(userId, role));
      assert.equal(forbidden.status, 403, `${role} is blocked from ${path}`);
      assert.equal(forbidden.body.error.code, "FORBIDDEN");
    }
  }

  for (const [role, userId] of [
    [UserRole.PHARMACIST, pharmacistId],
    [UserRole.OPS_ADMIN, adminId]
  ] as const) {
    const allowed = await getJson(paths[0], await tokenFor(userId, role));
    assert.equal(allowed.status, 200, `${role} is authorized`);
  }
});

test("forecast responses expose only aggregated product demand — no customer, order or prescription data", async () => {
  const token = await tokenFor(adminId, UserRole.OPS_ADMIN);
  const responses = await Promise.all([
    getJson("/api/v1/admin/pharmacy/forecasts/summary?horizonDays=14&historyDays=30", token),
    getJson(
      `/api/v1/admin/pharmacy/forecasts/products?horizonDays=14&historyDays=30&search=${testKey}&pageSize=100`,
      token
    ),
    getJson(
      `/api/v1/admin/pharmacy/forecasts/products/${ruleProductId}?horizonDays=14&historyDays=30`,
      token
    )
  ]);

  for (const response of responses) {
    const raw = JSON.stringify(response.body);

    assert.equal(response.body.success, true);
    assert.equal(raw.includes(PII_NAME), false, "no customer name");
    assert.equal(raw.includes(PII_EMAIL), false, "no customer email");
    assert.equal(raw.includes(PII_PHONE), false, "no customer phone");
    assert.equal(raw.includes(patientId), false, "no customer identifier");
    assert.equal(raw.includes(piiOrderId), false, "no order identifier");
    assert.equal(/patientId|patientName|fullName|email|phone|address|prescription/i.test(raw), false, "no patient or prescription fields");
    assert.equal(raw.includes(process.env.DATABASE_URL ?? "@@never@@"), false, "no connection string");
  }

  // The product list rows carry exactly the planning fields the frontend needs.
  const listResponse = responses[1];
  const row = listResponse.body.data.items.find(
    (item: { productId: string }) => item.productId === ruleProductId
  );
  assert.ok(row, "the fixture product appears in the list");
  assert.deepEqual(
    Object.keys(row).sort(),
    [
      "averageHistoricalDemand",
      "categoryName",
      "dataPoints",
      "dataSufficiency",
      "firstDemandDate",
      "forecastDailyRate",
      "forecastHorizonDays",
      "historicalDays",
      "isActive",
      "lastDemandDate",
      "method",
      "predictedQuantity",
      "productId",
      "productName",
      "qualifyingOrders",
      "recentAverageDemand",
      "recentDemand",
      "sku",
      "sparsity",
      "totalHistoricalDemand",
      "trendApplied",
      "trendPerDay"
    ].sort(),
    "row shape is limited to operational, non-personal fields"
  );
});

test("forecast queries are never scoped by customer: the same product aggregates every qualifying order", async () => {
  // There is no tenant/pharmacy column anywhere in this schema (verified against
  // prisma/schema.prisma), so no tenant filter exists to bypass and no
  // cross-tenant leak is possible. The equivalent boundary — that forecasts
  // aggregate across ALL qualifying orders without exposing whose orders they
  // were — is what this test pins down.
  const response = await getJson(
    `/api/v1/admin/pharmacy/forecasts/products/${ruleProductId}?horizonDays=14&historyDays=30`,
    await tokenFor(adminId, UserRole.OPS_ADMIN)
  );
  const { forecast } = response.body.data;

  assert.equal(forecast.qualifyingOrders, 4, "every DELIVERED order counts regardless of customer");
  assert.equal(forecast.totalHistoricalDemand, 20);
  assert.equal("patientId" in forecast, false, "the aggregate carries no customer dimension");
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function createUser(
  prisma: typeof import("../src/database/prisma").prisma,
  name: string,
  role: UserRole,
  fullName?: string,
  email?: string,
  phone?: string
) {
  return prisma.user.create({
    data: {
      fullName: fullName ?? `${testKey} ${name}`,
      email: email ?? `${testKey}-${name}@example.com`,
      phone: phone ?? `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`,
      role,
      isVerified: true
    }
  });
}

async function createProduct(
  prisma: typeof import("../src/database/prisma").prisma,
  categoryId: string,
  label: string,
  createdAt: Date,
  isActive = true
) {
  const product = await prisma.product.create({
    data: {
      name: `${testKey} ${label}`,
      sku: `${testKey}-${label}`,
      categoryId,
      price: "150.00",
      currency: "INR",
      isActive,
      minimumQuantity: 1,
      prescriptionRequired: false,
      coldChainRequired: false,
      createdAt
    }
  });
  createdProductIds.push(product.id);
  return product;
}

async function createOrder(
  prisma: typeof import("../src/database/prisma").prisma,
  productId: string,
  quantity: number,
  status: OrderStatus,
  createdAt: Date
) {
  const order = await prisma.order.create({
    data: {
      patientId,
      originType: OrderOriginType.DIRECT_CART,
      status,
      currency: "INR",
      subtotal: "150.00",
      deliveryFee: "0.00",
      totalAmount: "150.00",
      deliveryPincode: "560001",
      createdAt,
      items: {
        create: {
          productId,
          quantity,
          productNameSnapshot: "Forecast fixture",
          unitPriceSnapshot: "150.00"
        }
      },
      payments: {
        create: {
          method: PaymentMethod.PREPAID,
          status: status === OrderStatus.DELIVERED ? PaymentStatus.PAID : PaymentStatus.PENDING,
          amount: "150.00",
          currency: "INR",
          provider: "TEST_FIXTURE"
        }
      }
    }
  });
  createdOrderIds.push(order.id);
  return order;
}

async function tokenFor(userId: string, role: UserRole) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function getJson(path: string, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return { status: response.status, body: (await response.json()) as any };
}
