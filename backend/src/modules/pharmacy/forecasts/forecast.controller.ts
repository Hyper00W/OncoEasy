import type { RequestHandler } from "express";

import {
  getForecastSummary,
  getForecastTimeline,
  getProductForecast,
  listProductForecasts,
  runBacktest
} from "./forecast.service";
import type {
  ForecastBacktestQuery,
  ForecastProductParams,
  ForecastProductsQuery,
  ForecastWindowQuery
} from "./forecast.schemas";

/**
 * Phase 5.0 — demand forecast controllers.
 *
 * Every handler is read-only: the engine computes forecasts from current order
 * data on demand, so there is nothing to mutate and no audit event is written
 * for these reads (matching the existing audit policy, which records state
 * changes rather than read-only queries).
 */

export const summary: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await getForecastSummary(request.query as unknown as ForecastWindowQuery)
    });
  } catch (error) {
    next(error);
  }
};

export const products: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await listProductForecasts(request.query as unknown as ForecastProductsQuery)
    });
  } catch (error) {
    next(error);
  }
};

export const product: RequestHandler = async (request, response, next) => {
  try {
    const params = request.params as unknown as ForecastProductParams;
    const query = request.query as unknown as ForecastWindowQuery;
    response.status(200).json({
      success: true,
      data: await getProductForecast(params.productId, query)
    });
  } catch (error) {
    next(error);
  }
};

export const timeline: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await getForecastTimeline(request.query as unknown as ForecastWindowQuery)
    });
  } catch (error) {
    next(error);
  }
};

export const backtest: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await runBacktest(request.query as unknown as ForecastBacktestQuery)
    });
  } catch (error) {
    next(error);
  }
};
