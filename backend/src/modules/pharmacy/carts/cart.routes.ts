import { UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate } from "../../../middleware/authenticate";
import { requireRole } from "../../../middleware/require-role";
import { validateRequest } from "../../../middleware/validate-request";
import { addItem, clearCart, getCart, removeItem, updateItem } from "./cart.controller";
import {
  cartItemBodySchema,
  cartItemParamsSchema,
  cartItemQuantityBodySchema
} from "./cart.schemas";

export const cartRouter = Router();

cartRouter.use(authenticate, requireRole(UserRole.PATIENT));
cartRouter.get("/", getCart);
cartRouter.post("/items", validateRequest({ body: cartItemBodySchema }), addItem);
cartRouter.patch(
  "/items/:productId",
  validateRequest({ params: cartItemParamsSchema, body: cartItemQuantityBodySchema }),
  updateItem
);
cartRouter.delete(
  "/items/:productId",
  validateRequest({ params: cartItemParamsSchema }),
  removeItem
);
cartRouter.delete("/", clearCart);