import { UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate } from "../../../middleware/authenticate";
import { requireRole } from "../../../middleware/require-role";
import { validateRequest } from "../../../middleware/validate-request";
import { backtest, product, products, summary, timeline } from "./forecast.controller";
import {
  forecastBacktestQuerySchema,
  forecastProductParamsSchema,
  forecastProductsQuerySchema,
  forecastSummaryQuerySchema,
  forecastWindowQuerySchema
} from "./forecast.schemas";

/**
 * Phase 5.0 — admin/pharmacy demand forecast routes.
 *
 * Authorization matches the existing pharmacy-operations precedent
 * (`productImportRouter`): PHARMACIST and OPS_ADMIN. Forecasts describe the
 * pharmacy's own catalog and aggregate demand, so DELIVERY_AGENT, DOCTOR and
 * PATIENT are all rejected by the existing `requireRole` middleware — no new
 * authorization mechanism is introduced.
 *
 * Nothing here is public: every route inherits `authenticate` from the router.
 */
export const forecastRouter = Router();

forecastRouter.use(authenticate, requireRole(UserRole.PHARMACIST, UserRole.OPS_ADMIN, UserRole.OWNER));

forecastRouter.get("/summary", validateRequest({ query: forecastSummaryQuerySchema }), summary);

forecastRouter.get("/timeline", validateRequest({ query: forecastWindowQuerySchema }), timeline);

forecastRouter.get("/products", validateRequest({ query: forecastProductsQuerySchema }), products);

forecastRouter.get(
  "/products/:productId",
  validateRequest({ params: forecastProductParamsSchema, query: forecastWindowQuerySchema }),
  product
);

forecastRouter.get("/backtest", validateRequest({ query: forecastBacktestQuerySchema }), backtest);
