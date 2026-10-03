/**
 * Phase 5.0 — Pharmacy Demand Forecast Engine: deterministic demand model.
 *
 * This module is deliberately pure: it contains no database access, no I/O, no
 * clock reads and no randomness. Every value is derived from the supplied daily
 * demand series, so the same input always produces byte-identical output
 * (requirement: "deterministic for the same input data"). That property is what
 * makes the engine explainable, testable, and safe to run on request.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS / IS NOT
 * ---------------------------------------------------------------------------
 * This is an operational demand forecast: it estimates how many units of a
 * product are likely to be ordered in a future window, from historical order
 * data, so pharmacy/Ops users can plan stock. It is NOT a medical, clinical,
 * diagnostic, or treatment system, and it makes no clinical claims.
 *
 * ---------------------------------------------------------------------------
 * THE FORMULA (documented model, not machine learning)
 * ---------------------------------------------------------------------------
 * Input: a contiguous daily series of *units demanded* covering the observed
 * window, oldest first. `historicalDays` is the number of days actually
 * observed (a product created mid-window is only observed from its creation
 * date onward — days before it existed are not counted as zero demand).
 *
 * 1. Recency-weighted baseline daily rate
 *
 *        weight(age)  = RECENCY_DECAY ^ age          (age in days, 0 = today-1)
 *        baselineDailyRate = SUM(units_i * weight(age_i)) / SUM(weight(age_i))
 *
 *    The denominator spans EVERY observed day, including zero-demand days.
 *    That is deliberate: sparse or intermittent demand must lower the baseline
 *    rather than being ignored. The decay makes recent days matter more than
 *    distant ones (a plain mean would let a burst 80 days ago dominate today).
 *
 * 2. Trend (only when the history supports it)
 *
 *        slopePerDay = least-squares slope of units vs day index
 *
 *    Computed only when `dataPoints >= TREND_MIN_DATA_POINTS`, so a handful of
 *    observations cannot fabricate a trend.
 *
 * 3. Damped trend contribution, clamped for safety
 *
 *        trendContribution = slopePerDay * (horizonDays / 2)
 *        trendContribution = clamp(trendContribution,
 *                                  -TREND_CLAMP_RATIO * baselineDailyRate,
 *                                  +TREND_CLAMP_RATIO * baselineDailyRate)
 *
 *    Two deliberate dampers: the horizon midpoint halves a straight-line
 *    extrapolation, and the clamp prevents an extreme slope (a single spike)
 *    from dominating the forecast. `horizonDays / 2` is the average lead time
 *    across the forecast window.
 *
 *    `trendApplied` is true only when a fitted slope actually MOVED the rate
 *    (slope != 0). A flat series still has a slope fitted and reported as 0, but
 *    it is labelled with the base method because the trend term changed nothing.
 *    The fitted slope is always exposed via `trendPerDay`, so nothing is hidden.
 *
 * 4. Forecast
 *
 *        forecastDailyRate = max(0, baselineDailyRate + trendContribution)
 *        predictedQuantity = round(forecastDailyRate * horizonDays)
 *
 *    Rounding is to whole units (operational planning works in whole units) and
 *    the result is never negative.
 *
 * ---------------------------------------------------------------------------
 * DATA SUFFICIENCY (a data-volume heuristic — NOT a statistical confidence)
 * ---------------------------------------------------------------------------
 * `dataSufficiency` describes how much history backs the number. It is an
 * explicit, auditable rule table over observable counts, NOT a confidence
 * interval, probability, or accuracy claim. A HIGH label means "based on a
 * reasonable amount of history", never "likely to be correct".
 *
 * See classifySufficiency() for the exact table.
 */

/** Order statuses whose units count as realised demand. Matches the existing
 * analytics rule for a completed pharmacy order (see analytics.service.ts). */
export const DEMAND_ORDER_STATUSES = ["DELIVERED"] as const;

/** Horizons the API accepts (days). Deliberately a small closed set. */
export const SUPPORTED_HORIZONS = [7, 14, 30] as const;
export type ForecastHorizon = (typeof SUPPORTED_HORIZONS)[number];
export const DEFAULT_HORIZON_DAYS: ForecastHorizon = 14;

/** History window (`historyDays`) bounds. */
export const DEFAULT_HISTORY_DAYS = 90;
export const MIN_HISTORY_DAYS = 14;
export const MAX_HISTORY_DAYS = 365;

/** Days used for the "recent demand" figure. */
export const RECENT_DEMAND_DAYS = 7;

/** Exponential recency decay per day of age. */
export const RECENCY_DECAY = 0.9;

/** Minimum distinct demand days before a trend is fitted at all. */
export const TREND_MIN_DATA_POINTS = 14;

/** Trend contribution is clamped to this fraction of the baseline daily rate. */
export const TREND_CLAMP_RATIO = 0.5;

/** Day bucket granularity. Order timestamps are naive UTC (Prisma
 * `TIMESTAMP(3)`), so a bucket is a UTC calendar day. */
export const BUCKET_TIMEZONE = "UTC";

export const FORECAST_METHOD_BASE = "RECENCY_WEIGHTED_DAILY_AVERAGE";
export const FORECAST_METHOD_TREND = "RECENCY_WEIGHTED_DAILY_AVERAGE_WITH_DAMPED_TREND";
export const FORECAST_METHOD_NONE = "NONE";
export type ForecastMethod =
  | typeof FORECAST_METHOD_BASE
  | typeof FORECAST_METHOD_TREND
  | typeof FORECAST_METHOD_NONE;

export type DataSufficiency =
  | "HIGH_DATA_SUFFICIENCY"
  | "MEDIUM_DATA_SUFFICIENCY"
  | "LOW_DATA_SUFFICIENCY"
  | "INSUFFICIENT_DATA";

/** One aggregated database row: units demanded for a product on one UTC day. */
export type DailyDemandRow = {
  day: string; // YYYY-MM-DD (UTC)
  units: number;
};

export type DailySeriesPoint = { date: string; units: number };

/** Formats a Date as a UTC calendar day key. */
export function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Adds whole days to a YYYY-MM-DD key (date-only arithmetic, no timezone shift). */
export function addDays(dayKey: string, days: number): string {
  const base = Date.parse(`${dayKey}T00:00:00.000Z`);
  return toDayKey(new Date(base + days * 86_400_000));
}

/** Whole days between two YYYY-MM-DD keys (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / 86_400_000);
}

/**
 * Builds a contiguous daily series over `[startDay, endDay]` inclusive from
 * sparse aggregated rows. Days with no row are explicit zeros so that sparse
 * demand is represented honestly instead of being skipped.
 */
export function buildDailySeries(
  rows: readonly DailyDemandRow[],
  startDay: string,
  endDay: string
): DailySeriesPoint[] {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.units);
  }

  const length = daysBetween(startDay, endDay) + 1;
  const series: DailySeriesPoint[] = [];
  for (let offset = 0; offset < length; offset += 1) {
    const date = addDays(startDay, offset);
    series.push({ date, units: byDay.get(date) ?? 0 });
  }
  return series;
}

/** Ordinary least-squares slope of y over x = 0..n-1. */
export function leastSquaresSlope(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) {
    return 0;
  }
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((total, value) => total + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    numerator += (index - meanX) * (values[index] - meanY);
    denominator += (index - meanX) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The exact data-sufficiency rule table. Each branch is a deterministic
 * function of (dataPoints, historicalDays, sparsity) — nothing here estimates
 * accuracy or statistical confidence.
 *
 *   INSUFFICIENT_DATA : no day in the window had any demand (nothing to model)
 *   HIGH              : >= 21 demand days, >= 28 observed days, >= 30% of days had demand
 *   MEDIUM            : >=  7 demand days and >= 15% of observed days had demand
 *   LOW               : any other non-zero history (sparse/intermittent/new)
 */
export function classifySufficiency(input: {
  dataPoints: number;
  historicalDays: number;
}): DataSufficiency {
  const { dataPoints, historicalDays } = input;
  if (dataPoints === 0 || historicalDays === 0) {
    return "INSUFFICIENT_DATA";
  }
  const sparsity = dataPoints / historicalDays;
  if (dataPoints >= 21 && historicalDays >= 28 && sparsity >= 0.3) {
    return "HIGH_DATA_SUFFICIENCY";
  }
  if (dataPoints >= 7 && sparsity >= 0.15) {
    return "MEDIUM_DATA_SUFFICIENCY";
  }
  return "LOW_DATA_SUFFICIENCY";
}

export type ForecastComputation = {
  /** Whole units for the horizon. null ONLY when data is insufficient — a
   * precise-looking number is never invented from no history. */
  predictedQuantity: number | null;
  forecastDailyRate: number | null;
  baselineDailyRate: number;
  /** Units in the trailing RECENT_DEMAND_DAYS days. */
  recentDemand: number;
  recentDailyRate: number;
  /** Fitted slope, or null when there was not enough history to fit one. */
  trendPerDay: number | null;
  trendApplied: boolean;
  totalHistoricalUnits: number;
  /** Distinct observed days with demand > 0. */
  dataPoints: number;
  /** Days actually observed for this product inside the window. */
  historicalDays: number;
  /** dataPoints / historicalDays, rounded for display. */
  sparsity: number;
  dataSufficiency: DataSufficiency;
  method: ForecastMethod;
};

/**
 * Computes the forecast for one product from its observed daily series.
 *
 * `series` must be contiguous, oldest first, and already trimmed to the
 * product's observed window (see buildDailySeries).
 */
export function computeForecast(
  series: readonly DailySeriesPoint[],
  horizonDays: number,
  options: { recentDemandDays?: number } = {}
): ForecastComputation {
  const recentDemandDays = options.recentDemandDays ?? RECENT_DEMAND_DAYS;
  const historicalDays = series.length;
  const values = series.map((point) => point.units);

  const totalHistoricalUnits = values.reduce((total, units) => total + units, 0);
  const dataPoints = values.filter((units) => units > 0).length;

  // Recency-weighted baseline; the denominator includes zero-demand days.
  let weightedSum = 0;
  let weightTotal = 0;
  for (let index = 0; index < historicalDays; index += 1) {
    const age = historicalDays - 1 - index;
    const weight = RECENCY_DECAY ** age;
    weightedSum += values[index] * weight;
    weightTotal += weight;
  }
  const baselineDailyRate = weightTotal === 0 ? 0 : weightedSum / weightTotal;

  const recentWindowDays = Math.min(recentDemandDays, historicalDays);
  const recentDemand = recentWindowDays === 0 ? 0 : values.slice(historicalDays - recentWindowDays).reduce((total, units) => total + units, 0);
  const recentDailyRate = recentWindowDays === 0 ? 0 : recentDemand / recentWindowDays;

  // Trend only with enough distinct demand days.
  let trendPerDay: number | null = null;
  if (dataPoints >= TREND_MIN_DATA_POINTS && historicalDays >= TREND_MIN_DATA_POINTS) {
    trendPerDay = leastSquaresSlope(values);
  }

  const dataSufficiency = classifySufficiency({ dataPoints, historicalDays });

  if (dataSufficiency === "INSUFFICIENT_DATA") {
    return {
      predictedQuantity: null,
      forecastDailyRate: null,
      baselineDailyRate: 0,
      recentDemand,
      recentDailyRate: round2(recentDailyRate),
      trendPerDay: null,
      trendApplied: false,
      totalHistoricalUnits,
      dataPoints,
      historicalDays,
      sparsity: 0,
      dataSufficiency,
      method: FORECAST_METHOD_NONE
    };
  }

  let trendContribution = 0;
  const trendApplied = trendPerDay !== null && trendPerDay !== 0;
  if (trendPerDay !== null) {
    const raw = trendPerDay * (horizonDays / 2);
    const limit = TREND_CLAMP_RATIO * baselineDailyRate;
    trendContribution = clamp(raw, -limit, limit);
  }

  const forecastDailyRate = Math.max(0, baselineDailyRate + trendContribution);
  const predictedQuantity = Math.max(0, Math.round(forecastDailyRate * horizonDays));

  return {
    predictedQuantity,
    forecastDailyRate: round2(forecastDailyRate),
    baselineDailyRate: round2(baselineDailyRate),
    recentDemand,
    recentDailyRate: round2(recentDailyRate),
    trendPerDay: trendPerDay === null ? null : round4(trendPerDay),
    trendApplied,
    totalHistoricalUnits,
    dataPoints,
    historicalDays,
    sparsity: historicalDays === 0 ? 0 : round4(dataPoints / historicalDays),
    dataSufficiency,
    method: trendApplied ? FORECAST_METHOD_TREND : FORECAST_METHOD_BASE
  };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Backtest metrics for a set of (predicted, actual) pairs.
 *
 * - MAE  : mean absolute error, in units.
 * - WAPE : SUM|error| / SUM(actual) — the preferred metric for zero-heavy
 *          demand; null when there was no actual demand to divide by.
 * - MAPE : only reported when EVERY actual is > 0, because the usual
 *          divide-by-zero handling would silently inflate it.
 *
 * These are real measurements over the supplied pairs. No accuracy figure is
 * ever returned without the pairs behind it.
 */
export type AccuracyMetrics = {
  evaluatedPairs: number;
  mae: number | null;
  wape: number | null;
  mape: number | null;
  actualUnits: number;
  predictedUnits: number;
};

export function computeAccuracy(pairs: readonly { predicted: number; actual: number }[]): AccuracyMetrics {
  if (pairs.length === 0) {
    return { evaluatedPairs: 0, mae: null, wape: null, mape: null, actualUnits: 0, predictedUnits: 0 };
  }

  let absoluteError = 0;
  let actualUnits = 0;
  let predictedUnits = 0;
  let percentageSum = 0;
  let allActualsPositive = true;

  for (const pair of pairs) {
    const error = Math.abs(pair.predicted - pair.actual);
    absoluteError += error;
    actualUnits += pair.actual;
    predictedUnits += pair.predicted;
    if (pair.actual > 0) {
      percentageSum += error / pair.actual;
    } else {
      allActualsPositive = false;
    }
  }

  return {
    evaluatedPairs: pairs.length,
    mae: round2(absoluteError / pairs.length),
    wape: actualUnits > 0 ? round4(absoluteError / actualUnits) : null,
    mape: allActualsPositive ? round4(percentageSum / pairs.length) : null,
    actualUnits,
    predictedUnits
  };
}
