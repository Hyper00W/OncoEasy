import { UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate } from "../../../middleware/authenticate";
import { requireRole } from "../../../middleware/require-role";
import { validateRequest } from "../../../middleware/validate-request";
import { createOrder, getAdmin, getOrder, listAdmin, listOrders } from "./order.controller";
import { adminOrderListQuerySchema, createOrderBodySchema, orderParamsSchema } from "./order.schemas";

export const orderRouter = Router();

orderRouter.use(authenticate, requireRole(UserRole.PATIENT));
orderRouter.post("/", validateRequest({ body: createOrderBodySchema }), createOrder);
orderRouter.get("/", listOrders);
orderRouter.get("/:orderId", validateRequest({ params: orderParamsSchema }), getOrder);

export const adminOrderRouter = Router();
adminOrderRouter.use(authenticate, requireRole(UserRole.OPS_ADMIN, UserRole.OWNER));
adminOrderRouter.get("/", validateRequest({ query: adminOrderListQuerySchema }), listAdmin);
adminOrderRouter.get("/:orderId", validateRequest({ params: orderParamsSchema }), getAdmin);