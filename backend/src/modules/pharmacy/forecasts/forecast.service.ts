import { OrderStatus, Prisma } from "@prisma/client";

import { prisma } from "../../../database/prisma";
import { AppError } from "../../../errors/app-error";
import {
  DEFAULT_HISTORY_DAYS,
  FORECAST_METHOD_BASE,
  FORECAST_METHOD_NONE,
  FORECAST_METHOD_TREND,
  RECENCY_DECAY,
  RECENT_DEMAND_DAYS,
  TREND_CLAMP_RATIO,
  TREND_MIN_DATA_POINTS,
  addDays,
  buildDailySeries,
  classifySufficiency,
  clamp,
  computeAccuracy,
  computeForecast,
  daysBetween,
  leastSquaresSlope,
  toDayKey,
  type AccuracyMetrics,
  type DailyDemandRow,
  type DataSufficiency,
  type DailySeriesPoint,
  type ForecastComputation,
  type ForecastMethod
} from "./forecast.calculation";
import type {
  ForecastBacktestQuery,
  ForecastProductsQuery,
  ForecastWindowQuery
} from "./forecast.schemas";

/**
 * Phase 5.0 — demand forecast service.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS DEMAND (the single demand rule for this engine)
 * ---------------------------------------------------------------------------
 * An order contributes demand only when `orders.status = 'DELIVERED'`.
 *
 * This is not a new business rule: the existing analytics implementation
 * (`analytics.service.ts` → `completedPharmacyOrders`) already treats DELIVERED
 * as the single completed-pharmacy-order status. Every other status
 * (DRAFT, PENDING_*, PAID, PROCESSING, READY_FOR_DELIVERY, OUT_FOR_DELIVERY,
 * SHIPPED) is in-flight, and CANCELLED is explicitly not demand. Nothing else
 * counts.
 *
 * Two honest caveats about the data model, stated rather than worked around:
 *
 *   1. There is no test/UAT marker on any order in this schema, so demand
 *      cannot be filtered against marked-as-test orders — no such marker is
 *      invented here.
 *   2. Demand is attributed to the day the ORDER was created (`orders.created_at`),
 *      not the day it was delivered. Demand is a request signal, so the order
 *      date is the correct bucket; using delivery date would back-date spikes
 *      by the fulfilment lag.
 *
 * Quantity comes only from `order_items.quantity` — finalised demand. Cart
 * quantities are never read (carts are mutable and represent intent, not
 * demand).
 *
 * ---------------------------------------------------------------------------
 * OBSERVATION WINDOW
 * ---------------------------------------------------------------------------
 * The window is the `historyDays` COMPLETE UTC days ending yesterday. Today is
 * deliberately excluded: a partial day would depress every baseline for the
 * first hours of each day and make identical data produce different numbers
 * depending on wall-clock time. Ends are therefore stable within a UTC day,
 * which is what makes the engine deterministic for a fixed dataset.
 *
 * A product's observed window starts at max(windowStart, product creation day).
 * Days before a product existed are NOT counted as zero-demand days — counting
 * them would dilute a new product's average toward zero and understate demand.
 * That trimming is why `historicalDays` is per product, not just `historyDays`.
 *
 * ---------------------------------------------------------------------------
 * PERFORMANCE / MEMORY
 * ---------------------------------------------------------------------------
 * Aggregation happens in PostgreSQL, grouped by (product, UTC day), returning at
 * most products × days rows — never the orders themselves. Order history is
 * never loaded into Node memory, and there is exactly ONE aggregation query per
 * request (no per-SKU round trips, no N+1). The catalog lookup is a single
 * bounded `findMany`.
 *
 * ---------------------------------------------------------------------------
 * PERSISTENCE
 * ---------------------------------------------------------------------------
 * Deliberately stateless: forecasts are computed from current data on each
 * request, so a cached forecast can never be mistaken for the current one, and
 * no forecast table, scheduled job, or invalidation logic is needed. Only an
 * index migration accompanies this feature (see the migration for the query it
 * serves).
 */

/** Raw aggregation row: one product, one UTC day. */
type RawDailyDemand = {
  productId: string;
  day: string; // YYYY-MM-DD (UTC), produced by to_char so no timezone is inferred
  units: number;
  orders: number;
};

/** Products present in a catalog lookup, trimmed to non-PII operational fields. */
const productSelect = {
  id: true,
  sku: true,
  name: true,
  isActive: true,
  createdAt: true,
  category: { select: { name: true } }
} satisfies Prisma.ProductSelect;

type ProductRecord = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

/**
 * Upper bound on how many catalog rows a search may pull into memory. The
 * forecast list is a planning table, not an export; a search that matches more
 * than this is reported as truncated rather than silently paging through a
 * much larger result. (Pagination itself still applies on top of this.)
 */
const MAX_CATALOG_CANDIDATES = 2000;

/** Hard cap on the backtest look-back span, so folds cannot request unbounded history. */
const MAX_BACKTEST_SPAN_DAYS = 800;

export type ForecastRow = {
  productId: string;
  sku: string;
  productName: string;
  categoryName: string | null;
  isActive: boolean;
  forecastHorizonDays: number;
  /** Whole units for the horizon. null when dataSufficiency is INSUFFICIENT_DATA. */
  predictedQuantity: number | null;
  forecastDailyRate: number | null;
  averageHistoricalDemand: number;
  recentAverageDemand: number;
  totalHistoricalDemand: number;
  recentDemand: number;
  qualifyingOrders: number;
  historicalDays: number;
  dataPoints: number;
  sparsity: number;
  firstDemandDate: string;
  lastDemandDate: string;
  trendPerDay: number | null;
  trendApplied: boolean;
  method: ForecastMethod;
  dataSufficiency: DataSufficiency;
};

export type ForecastWindow = {
  startDate: string;
  endDate: string;
  historyDays: number;
  recentDemandDays: number;
};

/** Resolves the query's window into concrete inclusive UTC day keys. */
function resolveWindow(query: ForecastWindowQuery, extraDays = 0): {
  startDay: string;
  endDay: string;
  historyDays: number;
  queryStartDay: string;
} {
  const endDay = toDayKey(new Date(Date.now() - 86_400_000)); // yesterday (UTC)
  const historyDays = query.historyDays ?? DEFAULT_HISTORY_DAYS;
  const startDay = addDays(endDay, -(historyDays - 1));
  return { startDay, endDay, historyDays, queryStartDay: addDays(startDay, -extraDays) };
}

/**
 * The single aggregation query. One round trip, grouped and summed by the
 * database, bounded by [startDay, endDay] inclusive.
 */
async function aggregateDailyDemand(input: {
  startDay: string;
  endDay: string;
}): Promise<RawDailyDemand[]> {
  const endExclusive = addDays(input.endDay, 1);

  return prisma.$queryRaw<RawDailyDemand[]>(Prisma.sql`
    SELECT
      oi.product_id AS "productId",
      to_char(o.created_at, 'YYYY-MM-DD') AS "day",
      SUM(oi.quantity)::int AS "units",
      COUNT(DISTINCT o.id)::int AS "orders"
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status = ${OrderStatus.DELIVERED}::"OrderStatus"
      AND o.created_at >= ${input.startDay}::date
      AND o.created_at < ${endExclusive}::date
    GROUP BY oi.product_id, to_char(o.created_at, 'YYYY-MM-DD')
  `);
}

type ProductDemand = {
  rows: DailyDemandRow[];
  totalUnits: number;
  qualifyingOrders: number;
  firstDemandDay: string | null;
  lastDemandDay: string | null;
};

function groupByProduct(raw: readonly RawDailyDemand[]): Map<string, ProductDemand> {
  const grouped = new Map<string, ProductDemand>();

  for (const row of raw) {
    let entry = grouped.get(row.productId);
    if (!entry) {
      entry = { rows: [], totalUnits: 0, qualifyingOrders: 0, firstDemandDay: null, lastDemandDay: null };
      grouped.set(row.productId, entry);
    }

    entry.rows.push({ day: row.day, units: row.units });
    entry.totalUnits += row.units;
    // Each order sits in exactly one day bucket, so per-day distinct counts can
    // be summed across days without double counting.
    entry.qualifyingOrders += row.orders;
    if (row.units > 0) {
      if (entry.firstDemandDay === null || row.day < entry.firstDemandDay) {
        entry.firstDemandDay = row.day;
      }
      if (entry.lastDemandDay === null || row.day > entry.lastDemandDay) {
        entry.lastDemandDay = row.day;
      }
    }
  }

  return grouped;
}

/**
 * Computes one product's forecast from its demand history.
 *
 * Observation trimming: the series starts at max(windowStart, product creation
 * UTC day). `historyDays` in the result is the number of days actually observed.
 */
function buildRow(input: {
  product: ProductRecord;
  demand: ProductDemand | undefined;
  window: ForecastWindow;
  horizonDays: number;
}): ForecastRow {
  const { product, demand, window, horizonDays } = input;

  const productCreatedDay = toDayKey(product.createdAt);
  const observedStart = productCreatedDay > window.startDate ? productCreatedDay : window.startDate;

  // A product created after the window end has not been observed at all.
  const observedDays = daysBetween(observedStart, window.endDate) + 1;
  const series: DailySeriesPoint[] =
    observedDays <= 0 ? [] : buildDailySeries(demand?.rows ?? [], observedStart, window.endDate);

  const computation: ForecastComputation = computeForecast(series, horizonDays);

  return {
    productId: product.id,
    sku: product.sku,
    productName: product.name,
    categoryName: product.category?.name ?? null,
    isActive: product.isActive,
    forecastHorizonDays: horizonDays,
    predictedQuantity: computation.predictedQuantity,
    forecastDailyRate: computation.forecastDailyRate,
    averageHistoricalDemand: round2(computation.totalHistoricalUnits / Math.max(1, computation.historicalDays)),
    recentAverageDemand: computation.recentDailyRate,
    totalHistoricalDemand: computation.totalHistoricalUnits,
    recentDemand: computation.recentDemand,
    qualifyingOrders: demand?.qualifyingOrders ?? 0,
    historicalDays: computation.historicalDays,
    dataPoints: computation.dataPoints,
    sparsity: computation.sparsity,
    firstDemandDate: demand?.firstDemandDay ?? "",
    lastDemandDate: demand?.lastDemandDay ?? "",
    trendPerDay: computation.trendPerDay,
    trendApplied: computation.trendApplied,
    method: computation.method,
    dataSufficiency: computation.dataSufficiency
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Forecast rows for every product that had demand inside the window. */
async function loadForecastRows(query: ForecastWindowQuery): Promise<{
  window: ForecastWindow;
  rows: ForecastRow[];
  demandByProduct: Map<string, ProductDemand>;
}> {
  const { startDay, endDay, historyDays } = resolveWindow(query);
  const horizonDays = query.horizonDays;
  const window: ForecastWindow = {
    startDate: startDay,
    endDate: endDay,
    historyDays,
    recentDemandDays: RECENT_DEMAND_DAYS
  };

  const raw = await aggregateDailyDemand({ startDay, endDay });
  const demandByProduct = groupByProduct(raw);

  const productIds = [...demandByProduct.keys()];
  if (productIds.length === 0) {
    return { window, rows: [], demandByProduct };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: productSelect
  });

  const rows = products.map((product) =>
    buildRow({ product, demand: demandByProduct.get(product.id), window, horizonDays })
  );

  return { window, rows, demandByProduct };
}

function sortRows(rows: ForecastRow[], sort: string, order: "asc" | "desc"): ForecastRow[] {
  const direction = order === "asc" ? 1 : -1;
  const sorted = [...rows];

  sorted.sort((left, right) => {
    switch (sort) {
      case "sku":
        return direction * left.sku.localeCompare(right.sku);
      case "productName":
        return direction * left.productName.localeCompare(right.productName);
      case "recentDemand":
        return direction * (left.recentDemand - right.recentDemand);
      case "totalHistoricalDemand":
        return direction * (left.totalHistoricalDemand - right.totalHistoricalDemand);
      default:
        // Default ordering: highest expected demand first, with unpredicted
        // (insufficient-data) products always last regardless of direction.
        if (left.predictedQuantity === null && right.predictedQuantity === null) {
          return right.totalHistoricalDemand - left.totalHistoricalDemand;
        }
        if (left.predictedQuantity === null) {
          return 1;
        }
        if (right.predictedQuantity === null) {
          return -1;
        }
        return direction * (left.predictedQuantity - right.predictedQuantity);
    }
  });

  return sorted;
}

/** GET /admin/pharmacy/forecasts/summary */
export async function getForecastSummary(query: ForecastWindowQuery, topProducts = 10) {
  const { window, rows } = await loadForecastRows(query);

  const withForecast = rows.filter((row) => row.predictedQuantity !== null);
  const distribution = {
    HIGH_DATA_SUFFICIENCY: 0,
    MEDIUM_DATA_SUFFICIENCY: 0,
    LOW_DATA_SUFFICIENCY: 0,
    INSUFFICIENT_DATA: 0
  };
  for (const row of rows) {
    distribution[row.dataSufficiency] += 1;
  }

  const sum = (pick: (row: ForecastRow) => number) => rows.reduce((total, row) => total + pick(row), 0);

  const ranked = sortRows(withForecast, "predictedQuantity", "desc").slice(0, topProducts);

  return {
    horizonDays: query.horizonDays,
    historyDays: window.historyDays,
    window: { startDate: window.startDate, endDate: window.endDate },
    generatedAt: new Date().toISOString(),
    demandRule: { orderStatuses: [OrderStatus.DELIVERED], quantitySource: "order_items.quantity" },
    totals: {
      productsWithDemandHistory: rows.length,
      productsWithForecast: withForecast.length,
      productsInsufficientData: distribution.INSUFFICIENT_DATA,
      predictedUnits: withForecast.reduce((total, row) => total + (row.predictedQuantity ?? 0), 0),
      historicalUnits: sum((row) => row.totalHistoricalDemand),
      recentUnits: sum((row) => row.recentDemand)
    },
    dataSufficiency: distribution,
    topProducts: ranked.map(toSummaryLine)
  };
}

function toSummaryLine(row: ForecastRow) {
  return {
    productId: row.productId,
    sku: row.sku,
    productName: row.productName,
    predictedQuantity: row.predictedQuantity,
    recentDemand: row.recentDemand,
    totalHistoricalDemand: row.totalHistoricalDemand,
    dataSufficiency: row.dataSufficiency,
    method: row.method
  };
}

/** GET /admin/pharmacy/forecasts/products */
export async function listProductForecasts(query: ForecastProductsQuery) {
  const { window, rows } = await loadForecastRows(query);

  let candidates = rows;
  let universe: "PRODUCTS_WITH_DEMAND_IN_WINDOW" | "CATALOG_SEARCH" = "PRODUCTS_WITH_DEMAND_IN_WINDOW";
  let catalogTruncated = false;

  if (query.search) {
    // A SKU search must be able to surface a product with no demand at all —
    // "insufficient data" is a real, useful answer. So the search path resolves
    // products from the catalog instead of from the demand aggregation.
    universe = "CATALOG_SEARCH";
    const matched = await prisma.product.findMany({
      where: {
        OR: [
          { sku: { contains: query.search, mode: "insensitive" } },
          { name: { contains: query.search, mode: "insensitive" } }
        ]
      },
      select: productSelect,
      orderBy: { sku: "asc" },
      take: MAX_CATALOG_CANDIDATES + 1
    });

    catalogTruncated = matched.length > MAX_CATALOG_CANDIDATES;
    const matchedProducts = catalogTruncated ? matched.slice(0, MAX_CATALOG_CANDIDATES) : matched;

    const byId = new Map(rows.map((row) => [row.productId, row]));
    candidates = matchedProducts.map(
      (product) =>
        byId.get(product.id) ??
        buildRow({ product, demand: undefined, window, horizonDays: query.horizonDays })
    );
  }

  if (!query.includeInactive) {
    candidates = candidates.filter((row) => row.isActive);
  }
  if (query.dataSufficiency) {
    candidates = candidates.filter((row) => row.dataSufficiency === query.dataSufficiency);
  }

  const sorted = sortRows(candidates, query.sort, query.order);
  const skip = (query.page - 1) * query.pageSize;
  const items = sorted.slice(skip, skip + query.pageSize);

  return {
    horizonDays: query.horizonDays,
    historyDays: window.historyDays,
    window: { startDate: window.startDate, endDate: window.endDate },
    generatedAt: new Date().toISOString(),
    universe,
    catalogTruncated,
    items,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: sorted.length,
      totalPages: Math.ceil(sorted.length / query.pageSize)
    }
  };
}

export type ForecastDetail = {
  product: {
    productId: string;
    sku: string;
    productName: string;
    categoryName: string | null;
    isActive: boolean;
    unitLabel: string | null;
  };
  forecast: ForecastRow & { cohortDays: number };
  historicalDemand: {
    windowStart: string;
    observedFrom: string;
    windowEnd: string;
    observedDays: number;
    daily: DailySeriesPoint[];
    weekly: { weekStart: string; units: number }[];
    averageDailyDemand: number;
    recentDemandDays: number;
    recentDemand: number;
  };
};

/** GET /admin/pharmacy/forecasts/products/:productId */
export async function getProductForecast(
  productId: string,
  query: ForecastWindowQuery
): Promise<ForecastDetail> {
  const { startDay, endDay, historyDays } = resolveWindow(query);

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { ...productSelect, unitLabel: true }
  });
  if (!product) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }

  const raw = await aggregateDailyDemand({ startDay, endDay });
  const demand = groupByProduct(raw).get(productId);

  const window: ForecastWindow = {
    startDate: startDay,
    endDate: endDay,
    historyDays,
    recentDemandDays: RECENT_DEMAND_DAYS
  };
  const row = buildRow({ product, demand, window, horizonDays: query.horizonDays });

  const productCreatedDay = toDayKey(product.createdAt);
  const observedFrom = productCreatedDay > startDay ? productCreatedDay : startDay;
  const observedDays = daysBetween(observedFrom, endDay) + 1;
  const daily =
    observedDays <= 0 ? [] : buildDailySeries(demand?.rows ?? [], observedFrom, endDay);

  return {
    product: {
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      categoryName: product.category?.name ?? null,
      isActive: product.isActive,
      unitLabel: product.unitLabel ?? null
    },
    forecast: { ...row, cohortDays: historyDays },
    historicalDemand: {
      windowStart: startDay,
      observedFrom,
      windowEnd: endDay,
      observedDays: Math.max(0, observedDays),
      daily,
      weekly: toWeekly(daily),
      averageDailyDemand: round2(
        row.totalHistoricalDemand / Math.max(1, row.historicalDays)
      ),
      recentDemandDays: RECENT_DEMAND_DAYS,
      recentDemand: row.recentDemand
    }
  };
}

/** Buckets the daily series into Monday-anchored weeks for charting. */
function toWeekly(daily: readonly DailySeriesPoint[]): { weekStart: string; units: number }[] {
  const weeks = new Map<string, number>();
  for (const point of daily) {
    const weekday = new Date(`${point.date}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
    const mondayOffset = weekday === 0 ? 6 : weekday - 1;
    const weekStart = addDays(point.date, -mondayOffset);
    weeks.set(weekStart, (weeks.get(weekStart) ?? 0) + point.units);
  }
  return [...weeks.entries()]
    .map(([weekStart, units]) => ({ weekStart, units }))
    .sort((left, right) => left.weekStart.localeCompare(right.weekStart));
}

export type BacktestFold = {
  fold: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
};

export type BacktestResult =
  | {
      meaningful: false;
      reason: string;
      horizonDays: number;
      historyDays: number;
      folds: number;
      evaluatedProducts: number;
      metrics: AccuracyMetrics;
    }
  | {
      meaningful: true;
      horizonDays: number;
      historyDays: number;
      folds: number;
      evaluatedProducts: number;
      generatedAt: string;
      metrics: AccuracyMetrics;
      byFold: (BacktestFold & { evaluatedProducts: number; metrics: AccuracyMetrics })[];
      methodNote: string;
    };

/**
 * Rolling-origin backtest: for each fold, forecast the fold's test window using
 * ONLY data before that window, then compare against what actually happened.
 *
 * Folds walk backwards from the most recent complete day, so fold 1 is the most
 * recent out-of-sample period. Products with no demand anywhere in the tested
 * span are skipped (they are classified INSUFFICIENT_DATA and would otherwise
 * pad the metrics with trivially-correct zeros).
 */
export async function runBacktest(query: ForecastBacktestQuery): Promise<BacktestResult> {
  const horizonDays = query.horizonDays;
  const folds = query.folds;
  const historyDays = query.historyDays ?? DEFAULT_HISTORY_DAYS;

  const spanDays = historyDays + folds * horizonDays;
  if (spanDays > MAX_BACKTEST_SPAN_DAYS) {
    throw new AppError(
      400,
      "BACKTEST_SPAN_TOO_LARGE",
      `Requested backtest span of ${spanDays} days exceeds the ${MAX_BACKTEST_SPAN_DAYS}-day limit`
    );
  }

  const endDay = toDayKey(new Date(Date.now() - 86_400_000));
  const spanStart = addDays(endDay, -(spanDays - 1));

  const raw = await aggregateDailyDemand({ startDay: spanStart, endDay });
  const demandByProduct = groupByProduct(raw);

  const products = await prisma.product.findMany({
    where: { id: { in: [...demandByProduct.keys()] } },
    select: productSelect
  });

  const evaluatedPairs: { predicted: number; actual: number }[] = [];
  const byFold: (BacktestFold & { evaluatedProducts: number; metrics: AccuracyMetrics })[] = [];
  const productsWithDemand = new Set<string>();

  for (let fold = 1; fold <= folds; fold += 1) {
    const testEnd = addDays(endDay, -((fold - 1) * horizonDays));
    const testStart = addDays(testEnd, -(horizonDays - 1));
    const trainEnd = addDays(testStart, -1);
    const trainStart = addDays(trainEnd, -(historyDays - 1));

    const foldPairs: { predicted: number; actual: number }[] = [];

    for (const product of products) {
      const demand = demandByProduct.get(product.id);
      if (!demand) {
        continue;
      }

      const productCreatedDay = toDayKey(product.createdAt);
      const observedTrainStart =
        productCreatedDay > trainStart ? productCreatedDay : trainStart;

      const trainDays = daysBetween(observedTrainStart, trainEnd) + 1;
      if (trainDays <= 0) {
        continue;
      }

      // Training data only — nothing from the test window may leak in.
      const trainRows = demand.rows.filter((row) => row.day >= observedTrainStart && row.day <= trainEnd);
      const trainSeries = buildDailySeries(trainRows, observedTrainStart, trainEnd);
      const computation = computeForecast(trainSeries, horizonDays);

      // Insufficient data means no numeric forecast — such products are excluded
      // from the metrics rather than scored as a zero prediction.
      if (computation.predictedQuantity === null) {
        continue;
      }

      const actual = demand.rows
        .filter((row) => row.day >= testStart && row.day <= testEnd)
        .reduce((total, row) => total + row.units, 0);

      productsWithDemand.add(product.id);
      foldPairs.push({ predicted: computation.predictedQuantity, actual });
      evaluatedPairs.push({ predicted: computation.predictedQuantity, actual });
    }

    byFold.push({
      fold,
      trainStart,
      trainEnd,
      testStart,
      testEnd,
      evaluatedProducts: foldPairs.length,
      metrics: computeAccuracy(foldPairs)
    });
  }

  const metrics = computeAccuracy(evaluatedPairs);

  // A single scored product-fold pair is not a backtest; it is one observation.
  if (metrics.evaluatedPairs < 4) {
    return {
      meaningful: false,
      reason:
        "Backtesting is not statistically meaningful: fewer than four product/horizon observations had a forecast AND a matching actual demand window in the available history.",
      horizonDays,
      historyDays,
      folds,
      evaluatedProducts: productsWithDemand.size,
      metrics
    };
  }

  return {
    meaningful: true,
    horizonDays,
    historyDays,
    folds,
    evaluatedProducts: productsWithDemand.size,
    generatedAt: new Date().toISOString(),
    metrics,
    byFold,
    methodNote:
      "Rolling-origin backtest of the same deterministic model served by the forecast API. Errors are measured in units. WAPE is the primary metric (robust to zero-demand days); MAPE is null whenever any actual was zero."
  };
}

/** Exported for the sufficiency documentation test — the rule table lives in forecast.calculation.ts. */
export { classifySufficiency };

export type ForecastTimelinePoint = {
  date: string;
  units: number;
};

export type ForecastTimeline = {
  horizonDays: number;
  historyDays: number;
  /** Observed (delivered-order) series: complete UTC days ending yesterday. */
  historical: ForecastTimelinePoint[];
  /** Statistical projection over the horizon, computed by the SAME engine
   * (recency-weighted baseline + damped trend). A flat daily rate, so it is a
   * projection of the model — not a second forecast, and not confidence bands. */
  forecast: ForecastTimelinePoint[];
  forecastDailyRate: number;
  /** Engine method behind the portfolio-level projection. */
  method: ForecastMethod;
  /** Portfolio series stats for the chart's context strip. */
  stats: {
    historicalUnits: number;
    averageDailyUnits: number;
    peak: { date: string; units: number } | null;
    forecastUnits: number;
    trendPerDay: number;
  };
  generatedAt: string;
  demandRule: { orderStatuses: string[]; quantitySource: string };
};

/**
 * GET /admin/pharmacy/forecasts/timeline — portfolio-level historical demand
 * series plus the engine's own statistical projection for the horizon.
 *
 * Reuses the exact demand aggregation and computeForecast from the Phase 5.0
 * engine: nothing here is a new statistical method. The projection applies the
 * portfolio's own recency-weighted daily rate (+ damped trend when enough
 * distinct demand days exist) forward over the horizon — the same formula the
 * engine applies per product, applied to the portfolio series.
 */
export async function getForecastTimeline(query: ForecastWindowQuery): Promise<ForecastTimeline> {
  const { startDay, endDay, historyDays } = resolveWindow(query);

  const raw = await aggregateDailyDemand({ startDay, endDay });
  const byDay = new Map<string, number>();
  for (const row of raw) {
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.units);
  }
  const series = buildDailySeries([...byDay.entries()].map(([day, units]) => ({ day, units })), startDay, endDay);

  const values = series.map((point) => point.units);
  const historicalUnits = values.reduce((total, units) => total + units, 0);
  const dataPoints = values.filter((units) => units > 0).length;

  // The engine's own math, applied to the portfolio series (computeForecast's
  // core: recency weighting → baseline → damped, clamped trend).
  let weightedSum = 0;
  let weightTotal = 0;
  for (let index = 0; index < series.length; index += 1) {
    const age = series.length - 1 - index;
    const weight = RECENCY_DECAY ** age;
    weightedSum += values[index] * weight;
    weightTotal += weight;
  }
  const baselineDailyRate = weightTotal === 0 ? 0 : weightedSum / weightTotal;

  // TREND_MIN_DATA_POINTS gate, same as per-product forecasting.
  const trendPerDay =
    dataPoints >= TREND_MIN_DATA_POINTS && series.length >= TREND_MIN_DATA_POINTS
      ? leastSquaresSlope(values)
      : null;

  let trendContribution = 0;
  if (trendPerDay !== null) {
    trendContribution = clamp(
      trendPerDay * (query.horizonDays / 2),
      -TREND_CLAMP_RATIO * baselineDailyRate,
      TREND_CLAMP_RATIO * baselineDailyRate
    );
  }
  const forecastDailyRate = Math.max(0, baselineDailyRate + trendContribution);

  const method: ForecastMethod =
    dataPoints === 0
      ? FORECAST_METHOD_NONE
      : trendContribution !== 0
        ? FORECAST_METHOD_TREND
        : FORECAST_METHOD_BASE;

  // The forecast window starts the day after the observed window (today is
  // deliberately excluded from history; it stays excluded from projection).
  const forecastStart = addDays(endDay, 1);
  const forecast: ForecastTimelinePoint[] = [];
  for (let offset = 0; offset < query.horizonDays; offset += 1) {
    forecast.push({
      date: addDays(forecastStart, offset),
      units: Math.round(forecastDailyRate * 100) / 100
    });
  }

  const peakRow = series.reduce<ForecastTimelinePoint | null>(
    (peak, point) => (point.units > 0 && (peak === null || point.units > peak.units) ? point : peak),
    null
  );

  return {
    horizonDays: query.horizonDays,
    historyDays,
    historical: series,
    forecast,
    forecastDailyRate: round2(forecastDailyRate),
    method,
    stats: {
      historicalUnits,
      averageDailyUnits: round2(historicalUnits / Math.max(1, series.length)),
      peak: peakRow,
      forecastUnits: Math.round(forecastDailyRate * query.horizonDays),
      trendPerDay: trendPerDay === null ? 0 : round2(trendPerDay)
    },
    generatedAt: new Date().toISOString(),
    demandRule: { orderStatuses: [OrderStatus.DELIVERED], quantitySource: "order_items.quantity" }
  };
}
