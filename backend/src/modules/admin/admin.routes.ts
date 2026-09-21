import { UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/require-role";
import { validateRequest } from "../../middleware/validate-request";
import { overview } from "./admin.controller";
import { adminOverviewQuerySchema } from "./admin.schemas";

export const adminRouter = Router();
adminRouter.use(authenticate, requireRole(UserRole.OPS_ADMIN));
adminRouter.get("/overview", validateRequest({ query: adminOverviewQuerySchema }), overview);