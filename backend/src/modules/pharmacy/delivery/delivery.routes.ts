import { UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate } from "../../../middleware/authenticate";
import { requireRole } from "../../../middleware/require-role";
import { validateRequest } from "../../../middleware/validate-request";
import { updateDeliveryPincode, validateDelivery } from "./delivery.controller";
import { deliveryOrderParamsSchema, deliveryPincodeSchema } from "./delivery.schemas";

export const deliveryRouter = Router();

deliveryRouter.use(authenticate, requireRole(UserRole.PATIENT));
deliveryRouter.patch(
  "/:orderId/delivery-pincode",
  validateRequest({ params: deliveryOrderParamsSchema, body: deliveryPincodeSchema }),
  updateDeliveryPincode
);
deliveryRouter.post(
  "/:orderId/delivery/validate",
  validateRequest({ params: deliveryOrderParamsSchema }),
  validateDelivery
);