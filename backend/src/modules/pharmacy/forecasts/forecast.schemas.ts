import { z } from "zod";

import {
  DEFAULT_HISTORY_DAYS,
  DEFAULT_HORIZON_DAYS,
  MAX_HISTORY_DAYS,
  MIN_HISTORY_DAYS,
  SUPPORTED_HORIZONS
} from "./forecast.calculation";

/**
 * Query validation for the Phase 5.0 demand forecast API. Follows the existing
 * repository conventions: coerced numbers with explicit bounds, `.strict()` so
 * unknown parameters are rejected rather than silently ignored.
 */

const supportedHorizons: readonly number[] = SUPPORTED_HORIZONS;

const horizonDays = z.coerce
  .number()
  .int()
  .refine((value) => supportedHorizons.includes(value), {
    message: `horizonDays must be one of ${SUPPORTED_HORIZONS.join(", ")}`
  })
  .default(DEFAULT_HORIZON_DAYS);

const historyDays = z.coerce
  .number()
  .int()
  .min(MIN_HISTORY_DAYS, { message: `historyDays must be at least ${MIN_HISTORY_DAYS}` })
  .max(MAX_HISTORY_DAYS, { message: `historyDays must be at most ${MAX_HISTORY_DAYS}` })
  .default(DEFAULT_HISTORY_DAYS);

export const dataSufficiencyValues = [
  "HIGH_DATA_SUFFICIENCY",
  "MEDIUM_DATA_SUFFICIENCY",
  "LOW_DATA_SUFFICIENCY",
  "INSUFFICIENT_DATA"
] as const;

/** Shared window parameters for every forecast endpoint. */
export const forecastWindowQuerySchema = z
  .object({ horizonDays, historyDays })
  .strict();

export const forecastSortFields = [
  "predictedQuantity",
  "recentDemand",
  "totalHistoricalDemand",
  "sku",
  "productName"
] as const;

export const forecastProductsQuerySchema = z
  .object({
    horizonDays,
    historyDays,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().min(1).max(120).optional(),
    dataSufficiency: z.enum(dataSufficiencyValues).optional(),
    sort: z.enum(forecastSortFields).default("predictedQuantity"),
    order: z.enum(["asc", "desc"]).default("desc"),
    includeInactive: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true")
  })
  .strict();

export const forecastProductParamsSchema = z.object({
  productId: z.string().uuid()
});

export const forecastBacktestQuerySchema = z
  .object({
    horizonDays,
    historyDays,
    folds: z.coerce.number().int().min(1).max(8).default(4)
  })
  .strict();

/** Optional `top` bound on the summary endpoint (forecast summary cards). */
export const forecastSummaryQuerySchema = z
  .object({ horizonDays, historyDays })
  .strict();
export type ForecastWindowQuery = z.infer<typeof forecastWindowQuerySchema>;
export type ForecastProductsQuery = z.infer<typeof forecastProductsQuerySchema>;
export type ForecastProductParams = z.infer<typeof forecastProductParamsSchema>;
export type ForecastBacktestQuery = z.infer<typeof forecastBacktestQuerySchema>;
