import { apiClient } from "../api/client";

/**
 * Phase 5.0 — demand forecast API client.
 *
 * Types and read-only calls only: the forecast engine is stateless and every
 * endpoint is a GET, so there is nothing to mutate. The dashboard UI that
 * consumes these belongs to the next phase; this module exists so that phase
 * can be written against real, already-verified response shapes.
 *
 * Note what is absent by design: no customer, order, or prescription field is
 * modelled here, because the backend never returns them. Forecasts are
 * aggregated product demand only.
 */

type Envelope<T> = { success: true; data: T };

const data = <T>(request: Promise<Envelope<T>>): Promise<T> => request.then((response) => response.data);

/** Horizons the backend accepts. Sending anything else is a 400. */
export type ForecastHorizonDays = 7 | 14 | 30;

export const forecastHorizons: ForecastHorizonDays[] = [7, 14, 30];

/**
 * How much history backs a forecast. A statement about data volume, never a
 * claim of statistical confidence or accuracy.
 */
export type DataSufficiency =
  | "HIGH_DATA_SUFFICIENCY"
  | "MEDIUM_DATA_SUFFICIENCY"
  | "LOW_DATA_SUFFICIENCY"
  | "INSUFFICIENT_DATA";

/** Every data-sufficiency value the backend filter accepts (matches its zod enum). */
export const dataSufficiencyValues: readonly DataSufficiency[] = [
  "HIGH_DATA_SUFFICIENCY",
  "MEDIUM_DATA_SUFFICIENCY",
  "LOW_DATA_SUFFICIENCY",
  "INSUFFICIENT_DATA"
] as const;

export type ForecastMethod =
  | "RECENCY_WEIGHTED_DAILY_AVERAGE"
  | "RECENCY_WEIGHTED_DAILY_AVERAGE_WITH_DAMPED_TREND"
  | "NONE";

export type ForecastRow = {
  productId: string;
  sku: string;
  productName: string;
  categoryName: string | null;
  isActive: boolean;
  forecastHorizonDays: number;
  /** null exactly when dataSufficiency is INSUFFICIENT_DATA — render an empty state, not a zero. */
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
  /** Empty string when the product had no demand in the window. */
  firstDemandDate: string;
  lastDemandDate: string;
  trendPerDay: number | null;
  trendApplied: boolean;
  method: ForecastMethod;
  dataSufficiency: DataSufficiency;
};

export type ForecastTopProduct = Pick<
  ForecastRow,
  | "productId"
  | "sku"
  | "productName"
  | "predictedQuantity"
  | "recentDemand"
  | "totalHistoricalDemand"
  | "dataSufficiency"
  | "method"
>;

export type ForecastWindow = { startDate: string; endDate: string };

export type ForecastSummary = {
  horizonDays: number;
  historyDays: number;
  window: ForecastWindow;
  generatedAt: string;
  demandRule: { orderStatuses: string[]; quantitySource: string };
  totals: {
    productsWithDemandHistory: number;
    productsWithForecast: number;
    productsInsufficientData: number;
    predictedUnits: number;
    historicalUnits: number;
    recentUnits: number;
  };
  dataSufficiency: Record<DataSufficiency, number>;
  topProducts: ForecastTopProduct[];
};

export type ForecastListSort =
  | "predictedQuantity"
  | "recentDemand"
  | "totalHistoricalDemand"
  | "sku"
  | "productName";

export type ForecastProductList = {
  horizonDays: number;
  historyDays: number;
  window: ForecastWindow;
  generatedAt: string;
  /** Whether the rows came from products that had demand, or from a catalog search. */
  universe: "PRODUCTS_WITH_DEMAND_IN_WINDOW" | "CATALOG_SEARCH";
  catalogTruncated: boolean;
  items: ForecastRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type ForecastDailyPoint = { date: string; units: number };
export type ForecastWeeklyPoint = { weekStart: string; units: number };

export type ForecastProductDetail = {
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
    /** Observation start: max(window start, product creation day). */
    observedFrom: string;
    windowEnd: string;
    observedDays: number;
    daily: ForecastDailyPoint[];
    weekly: ForecastWeeklyPoint[];
    averageDailyDemand: number;
    recentDemandDays: number;
    recentDemand: number;
  };
};

/** Portfolio-level historical series + the engine's statistical projection (timeline chart). */
export type ForecastTimeline = {
  horizonDays: number;
  historyDays: number;
  historical: Array<{ date: string; units: number }>;
  forecast: Array<{ date: string; units: number }>;
  forecastDailyRate: number;
  method: ForecastMethod;
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

export type ForecastAccuracyMetrics = {
  evaluatedPairs: number;
  mae: number | null;
  wape: number | null;
  mape: number | null;
  actualUnits: number;
  predictedUnits: number;
};

export type ForecastBacktest = {
  meaningful: boolean;
  horizonDays: number;
  historyDays: number;
  folds: number;
  evaluatedProducts: number;
  metrics: ForecastAccuracyMetrics;
  /** Present when the backtest could not be scored — read this instead of inventing a number. */
  reason?: string;
  generatedAt?: string;
  methodNote?: string;
  byFold?: Array<{
    fold: number;
    trainStart: string;
    trainEnd: string;
    testStart: string;
    testEnd: string;
    evaluatedProducts: number;
    metrics: ForecastAccuracyMetrics;
  }>;
};

export type ForecastWindowQuery = {
  horizonDays?: ForecastHorizonDays;
  historyDays?: number;
};

export type ForecastProductsQuery = ForecastWindowQuery & {
  page?: number;
  pageSize?: number;
  search?: string;
  dataSufficiency?: DataSufficiency;
  sort?: ForecastListSort;
  order?: "asc" | "desc";
  includeInactive?: boolean;
};

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  (Object.entries(params) as Array<[string, string | number | boolean | undefined]>).forEach(
    ([key, value]) => {
      // Booleans are sent as strings: the backend schema accepts "true"/"false"
      // and rejects any other representation.
      if (value !== undefined && value !== "") {
        search.set(key, String(value));
      }
    }
  );
  const query = search.toString();
  return query ? `?${query}` : "";
}

/** Summary cards: totals, sufficiency distribution and the top expected-demand products. */
export function getForecastSummary(params: ForecastWindowQuery = {}) {
  return data(
    apiClient.get<Envelope<ForecastSummary>>(
      `/api/v1/admin/pharmacy/forecasts/summary${toQuery(params)}`
    )
  );
}

/** Paginated demand table, searchable by SKU/product name. */
export function listForecastProducts(params: ForecastProductsQuery = {}) {
  return data(
    apiClient.get<Envelope<ForecastProductList>>(
      `/api/v1/admin/pharmacy/forecasts/products${toQuery(params)}`
    )
  );
}

/** One product's forecast plus the historical series for a chart. */
export function getForecastProduct(productId: string, params: ForecastWindowQuery = {}) {
  return data(
    apiClient.get<Envelope<ForecastProductDetail>>(
      `/api/v1/admin/pharmacy/forecasts/products/${productId}${toQuery(params)}`
    )
  );
}

/** Portfolio daily series + the engine's statistical projection for the hero chart. */
export function getForecastTimeline(params: ForecastWindowQuery = {}) {
  return data(
    apiClient.get<Envelope<ForecastTimeline>>(
      `/api/v1/admin/pharmacy/forecasts/timeline${toQuery(params)}`
    )
  );
}

/** Rolling-origin backtest. When `meaningful` is false there are no accuracy numbers to show. */
export function getForecastBacktest(
  params: ForecastWindowQuery & { folds?: number } = {}
) {
  return data(
    apiClient.get<Envelope<ForecastBacktest>>(
      `/api/v1/admin/pharmacy/forecasts/backtest${toQuery(params)}`
    )
  );
}
