import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_HISTORY_DAYS,
  RECENCY_DECAY,
  SUPPORTED_HORIZONS,
  addDays,
  buildDailySeries,
  classifySufficiency,
  computeAccuracy,
  computeForecast,
  daysBetween,
  leastSquaresSlope,
  toDayKey
} from "../src/modules/pharmacy/forecasts/forecast.calculation";

/**
 * Phase 5.0 — pure unit tests for the deterministic demand model.
 *
 * These run without a database: the calculation module has no I/O, no clock and
 * no randomness, so every expectation here is an exact value rather than a
 * tolerance around a live query.
 */

function series(values: readonly number[], startDay = "2026-01-01") {
  return values.map((units, index) => ({ date: addDays(startDay, index), units }));
}

// ---------------------------------------------------------------------------
// Date and bucket helpers
// ---------------------------------------------------------------------------

test("day keys are UTC calendar days and day arithmetic crosses month and year boundaries", () => {
  assert.equal(toDayKey(new Date("2026-03-09T23:59:59.999Z")), "2026-03-09");
  assert.equal(toDayKey(new Date("2026-03-10T00:00:00.000Z")), "2026-03-10");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29", "leap years are handled");
  assert.equal(daysBetween("2026-01-01", "2026-01-31"), 30);
  assert.equal(daysBetween("2026-01-31", "2026-01-01"), -30);
});

test("buildDailySeries produces a contiguous zero-filled series and merges duplicate rows", () => {
  const built = buildDailySeries(
    [
      { day: "2026-01-01", units: 3 },
      { day: "2026-01-01", units: 4 },
      { day: "2026-01-03", units: 5 }
    ],
    "2026-01-01",
    "2026-01-04"
  );

  assert.deepEqual(built, [
    { date: "2026-01-01", units: 7 },
    { date: "2026-01-02", units: 0 },
    { date: "2026-01-03", units: 5 },
    { date: "2026-01-04", units: 0 }
  ]);
});

test("a single-day window produces a one-entry series", () => {
  const built = buildDailySeries([{ day: "2026-01-01", units: 2 }], "2026-01-01", "2026-01-01");
  assert.deepEqual(built, [{ date: "2026-01-01", units: 2 }]);
});

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

test("a flat series forecasts its exact constant daily rate at every supported horizon", () => {
  const flat = series(new Array(30).fill(10));

  for (const horizonDays of SUPPORTED_HORIZONS) {
    const result = computeForecast(flat, horizonDays);
    assert.equal(result.baselineDailyRate, 10);
    assert.equal(result.predictedQuantity, 10 * horizonDays);
    assert.equal(result.trendPerDay, 0, "a constant series has zero slope");
    assert.equal(result.trendApplied, false);
    assert.equal(result.method, "RECENCY_WEIGHTED_DAILY_AVERAGE");
  }
});

test("the forecast is deterministic: identical input yields identical output", () => {
  const input = series([0, 1, 0, 4, 7, 2, 0, 9, 3, 0, 5, 5, 0, 0, 6, 2, 0, 1, 8, 4]);
  const first = computeForecast(input, 14);
  const second = computeForecast(input, 14);
  assert.deepEqual(first, second);
});

test("recency weighting makes a recent burst count for more than an old one", () => {
  const recentBurst = series([...new Array(20).fill(0), ...new Array(10).fill(10)]);
  const oldBurst = series([...new Array(10).fill(10), ...new Array(20).fill(0)]);

  const recent = computeForecast(recentBurst, 7);
  const old = computeForecast(oldBurst, 7);

  assert.ok(
    recent.baselineDailyRate > old.baselineDailyRate,
    "identical totals produce a higher rate when the demand is recent"
  );
  assert.ok((recent.predictedQuantity ?? 0) > (old.predictedQuantity ?? 0));
  assert.equal(RECENCY_DECAY, 0.9, "the documented decay is the decay in use");
});

test("sparse demand is diluted by zero-demand days rather than ignored", () => {
  // One 10-unit day inside a 30-day window of otherwise zero demand.
  const sparse = series([...new Array(15).fill(0), 10, ...new Array(14).fill(0)]);
  const result = computeForecast(sparse, 14);

  assert.equal(result.dataPoints, 1);
  assert.equal(result.historicalDays, 30);
  assert.equal(result.totalHistoricalUnits, 10);
  assert.ok(
    (result.baselineDailyRate ?? 0) < 1,
    "a single demand day does not become a ~10/day rate"
  );
  assert.equal(result.dataSufficiency, "LOW_DATA_SUFFICIENCY");
});

test("a series with no demand at all yields no forecast rather than a fabricated one", () => {
  const result = computeForecast(series(new Array(30).fill(0)), 14);

  assert.equal(result.predictedQuantity, null);
  assert.equal(result.forecastDailyRate, null);
  assert.equal(result.baselineDailyRate, 0);
  assert.equal(result.dataPoints, 0);
  assert.equal(result.dataSufficiency, "INSUFFICIENT_DATA");
  assert.equal(result.method, "NONE");
});

test("an empty series is insufficient data, never a zero forecast", () => {
  const result = computeForecast([], 7);
  assert.equal(result.predictedQuantity, null);
  assert.equal(result.historicalDays, 0);
  assert.equal(result.dataSufficiency, "INSUFFICIENT_DATA");
});

test("predictions are never negative for collapsing, spiky or intermittent demand", () => {
  const collapsing = series([...new Array(20).fill(100), ...new Array(10).fill(0)]);
  const spike = series([0, 0, 0, 0, 500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2]);
  const intermittent = series([0, 5, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 9, 0, 0]);

  for (const input of [collapsing, spike, intermittent]) {
    for (const horizonDays of SUPPORTED_HORIZONS) {
      const result = computeForecast(input, horizonDays);
      if (result.predictedQuantity !== null) {
        assert.ok(result.predictedQuantity >= 0, "never negative");
        assert.ok(Number.isSafeInteger(result.predictedQuantity), "whole units");
      }
      assert.ok(result.baselineDailyRate >= 0);
      assert.ok((result.forecastDailyRate ?? 0) >= 0);
    }
  }
});

test("trend is only fitted once enough demand days exist", () => {
  const thirteenDemandDays = series([...new Array(13).fill(8), ...new Array(17).fill(0)]);
  const fourteenDemandDays = series([...new Array(14).fill(8), ...new Array(16).fill(0)]);

  assert.equal(computeForecast(thirteenDemandDays, 7).trendPerDay, null);
  assert.equal(computeForecast(thirteenDemandDays, 7).trendApplied, false);

  const withTrend = computeForecast(fourteenDemandDays, 7);
  assert.ok(withTrend.trendPerDay !== null && withTrend.trendPerDay < 0);
  assert.equal(withTrend.trendApplied, true);
  assert.equal(withTrend.method, "RECENCY_WEIGHTED_DAILY_AVERAGE_WITH_DAMPED_TREND");
});

test("a zero slope is reported but is not labelled as an applied trend", () => {
  const flat = computeForecast(series(new Array(30).fill(6)), 14);

  assert.equal(flat.trendPerDay, 0, "the fitted slope is still exposed");
  assert.equal(flat.trendApplied, false, "a zero slope moved nothing");
  assert.equal(flat.method, "RECENCY_WEIGHTED_DAILY_AVERAGE");
});

test("the damped trend is clamped to half the baseline in both directions", () => {
  const declining = series([...new Array(14).fill(60), ...new Array(16).fill(0)]);
  const growing = series([...new Array(14).fill(0), ...new Array(16).fill(60)]);

  for (const input of [declining, growing]) {
    const result = computeForecast(input, 30);
    assert.ok(result.trendApplied);
    assert.ok(result.forecastDailyRate !== null);

    const lower = 0.5 * result.baselineDailyRate - 0.01;
    const upper = 1.5 * result.baselineDailyRate + 0.01;
    assert.ok(
      result.forecastDailyRate >= Math.max(0, lower) && result.forecastDailyRate <= upper,
      "the clamped trend keeps the daily rate within [0.5x, 1.5x] of the baseline"
    );
  }
});

test("recent demand is measured over the trailing seven days", () => {
  const input = series([...new Array(23).fill(0), 1, 2, 3, 4, 5, 6, 7]);
  const result = computeForecast(input, 7);

  assert.equal(result.recentDemand, 28);
  assert.equal(result.recentDailyRate, 4);
});

test("a shorter observation window is handled without inventing history", () => {
  const twoDays = computeForecast(series([4, 8]), 7);
  assert.equal(twoDays.historicalDays, 2);
  assert.equal(twoDays.dataPoints, 2);
  assert.equal(twoDays.recentDemand, 12, "recent demand never exceeds the observed window");
  assert.equal(twoDays.dataSufficiency, "LOW_DATA_SUFFICIENCY");
  assert.ok((twoDays.predictedQuantity ?? 0) >= 0);
});

test("very large quantities stay finite and non-negative", () => {
  const huge = series([...new Array(20).fill(1_000_000)]);
  const result = computeForecast(huge, 30);

  assert.ok(Number.isFinite(result.predictedQuantity));
  assert.ok((result.predictedQuantity ?? 0) > 0);
  assert.ok(Number.isFinite(result.baselineDailyRate));
});

test("leastSquaresSlope reports the sign and magnitude of a known trend", () => {
  assert.equal(leastSquaresSlope([5, 5, 5, 5]), 0);
  assert.equal(leastSquaresSlope([1, 2, 3, 4]), 1);
  assert.equal(leastSquaresSlope([4, 3, 2, 1]), -1);
  assert.equal(leastSquaresSlope([7]), 0, "a single point cannot define a trend");
});

// ---------------------------------------------------------------------------
// Data sufficiency rule table
// ---------------------------------------------------------------------------

test("the data sufficiency table matches its documented thresholds exactly", () => {
  // INSUFFICIENT_DATA: nothing to model.
  assert.equal(classifySufficiency({ dataPoints: 0, historicalDays: 30 }), "INSUFFICIENT_DATA");
  assert.equal(classifySufficiency({ dataPoints: 5, historicalDays: 0 }), "INSUFFICIENT_DATA");

  // HIGH: >= 21 demand days, >= 28 observed days, >= 30% density.
  assert.equal(classifySufficiency({ dataPoints: 21, historicalDays: 30 }), "HIGH_DATA_SUFFICIENCY");
  assert.equal(classifySufficiency({ dataPoints: 21, historicalDays: 28 }), "HIGH_DATA_SUFFICIENCY");
  assert.equal(
    classifySufficiency({ dataPoints: 20, historicalDays: 30 }),
    "MEDIUM_DATA_SUFFICIENCY",
    "20 demand days is one short of HIGH"
  );
  assert.equal(
    classifySufficiency({ dataPoints: 21, historicalDays: 27 }),
    "MEDIUM_DATA_SUFFICIENCY",
    "27 observed days is one short of HIGH"
  );
  assert.equal(
    classifySufficiency({ dataPoints: 21, historicalDays: 100 }),
    "MEDIUM_DATA_SUFFICIENCY",
    "21 of 100 days is too sparse for HIGH"
  );

  // MEDIUM: >= 7 demand days and >= 15% density.
  assert.equal(classifySufficiency({ dataPoints: 7, historicalDays: 30 }), "MEDIUM_DATA_SUFFICIENCY");
  assert.equal(
    classifySufficiency({ dataPoints: 6, historicalDays: 30 }),
    "LOW_DATA_SUFFICIENCY",
    "6 demand days is one short of MEDIUM"
  );
  assert.equal(
    classifySufficiency({ dataPoints: 7, historicalDays: 60 }),
    "LOW_DATA_SUFFICIENCY",
    "7 of 60 days is below the 15% density floor"
  );

  // LOW: any other non-empty history.
  assert.equal(classifySufficiency({ dataPoints: 1, historicalDays: 30 }), "LOW_DATA_SUFFICIENCY");
  assert.equal(classifySufficiency({ dataPoints: 1, historicalDays: 14 }), "LOW_DATA_SUFFICIENCY");
});

test("the sufficiency labels never claim statistical confidence", () => {
  const labels = new Set(
    [0, 1, 7, 21, 30].flatMap((dataPoints) =>
      [0, 14, 27, 28, 30, 90].map((historicalDays) =>
        classifySufficiency({ dataPoints, historicalDays })
      )
    )
  );

  for (const label of labels) {
    assert.match(label, /_SUFFICIENCY$|^INSUFFICIENT_DATA$/);
    assert.equal(/CONFIDENCE|ACCURACY|PROBABILITY/.test(label), false, `${label} claims more than data volume`);
  }
});

// ---------------------------------------------------------------------------
// Backtest metrics
// ---------------------------------------------------------------------------

test("accuracy metrics are computed correctly over known pairs", () => {
  const metrics = computeAccuracy([
    { predicted: 10, actual: 12 },
    { predicted: 20, actual: 18 },
    { predicted: 5, actual: 5 }
  ]);

  assert.equal(metrics.evaluatedPairs, 3);
  // Absolute errors 2, 2, 0 -> MAE 4/3.
  assert.equal(metrics.mae, Number((4 / 3).toFixed(2)));
  // WAPE = 4 / 35.
  assert.equal(metrics.wape, Number((4 / 35).toFixed(4)));
  // MAPE = (2/12 + 2/18 + 0/5) / 3
  assert.equal(metrics.mape, Number(((2 / 12 + 2 / 18 + 0 / 5) / 3).toFixed(4)));
  assert.equal(metrics.actualUnits, 35);
  assert.equal(metrics.predictedUnits, 35);
});

test("MAPE is withheld whenever any actual is zero, while WAPE still applies", () => {
  const metrics = computeAccuracy([
    { predicted: 5, actual: 0 },
    { predicted: 5, actual: 10 }
  ]);

  assert.equal(metrics.mape, null, "a zero actual makes percentage error undefined");
  assert.equal(metrics.mae, 5, "absolute errors of 5 and 5 average to 5");
  // WAPE = SUM|error| / SUM(actual) = (5 + 5) / 10.
  assert.equal(metrics.wape, 1);
});

test("metrics over no pairs are null rather than zero", () => {
  const metrics = computeAccuracy([]);
  assert.equal(metrics.evaluatedPairs, 0);
  assert.equal(metrics.mae, null);
  assert.equal(metrics.wape, null);
  assert.equal(metrics.mape, null);
});

test("WAPE is null when there was no actual demand to divide by", () => {
  const metrics = computeAccuracy([
    { predicted: 0, actual: 0 },
    { predicted: 3, actual: 0 }
  ]);
  assert.equal(metrics.wape, null);
  assert.equal(metrics.mae, 1.5);
});

test("a stable series is forecast exactly out of sample", () => {
  const train = series(new Array(30).fill(5));
  const testWindow = series(new Array(7).fill(5), addDays("2026-01-01", 30));

  const forecast = computeForecast(train, 7);
  const actualUnits = testWindow.reduce((total, point) => total + point.units, 0);
  const metrics = computeAccuracy([{ predicted: forecast.predictedQuantity!, actual: actualUnits }]);

  assert.equal(forecast.predictedQuantity, 35);
  assert.equal(actualUnits, 35);
  assert.equal(metrics.mae, 0);
  assert.equal(metrics.wape, 0);
});

test("including the test window in training inflates apparent accuracy, which is why the fold boundary exists", () => {
  const train = series(new Array(30).fill(5));
  // A step change in the test window: an honest model trained only on the flat
  // history must miss it, whereas a leaky model that peeked cannot.
  const testWindow = series(new Array(7).fill(50), addDays("2026-01-01", 30));
  const actualUnits = testWindow.reduce((total, point) => total + point.units, 0);

  const honest = computeForecast(train, 7);
  const leaky = computeForecast([...train, ...testWindow], 7);

  const honestMetrics = computeAccuracy([{ predicted: honest.predictedQuantity!, actual: actualUnits }]);
  const leakyMetrics = computeAccuracy([{ predicted: leaky.predictedQuantity!, actual: actualUnits }]);

  assert.equal(honest.predictedQuantity, 35, "honest model sees only the flat history");
  assert.ok(leakyMetrics.wape! < honestMetrics.wape!, "peeking improves the score — leakage flatters a backtest");
  assert.equal(honestMetrics.wape, Number((Math.abs(35 - 350) / 350).toFixed(4)));
});

test("the supported horizons and history bounds the API advertises are the ones enforced", () => {
  assert.deepEqual([...SUPPORTED_HORIZONS], [7, 14, 30]);
  assert.equal(MAX_HISTORY_DAYS, 365);
});
