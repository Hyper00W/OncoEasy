import { UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/require-role";
import { validateRequest } from "../../middleware/validate-request";
import { events, overview } from "./analytics.controller";
import { analyticsDateRangeSchema, analyticsEventsQuerySchema } from "./analytics.schemas";

export const analyticsRouter = Router();
analyticsRouter.use(authenticate, requireRole(UserRole.OPS_ADMIN, UserRole.OWNER));
analyticsRouter.get("/overview", validateRequest({ query: analyticsDateRangeSchema }), overview);
analyticsRouter.get("/events", validateRequest({ query: analyticsEventsQuerySchema }), events);