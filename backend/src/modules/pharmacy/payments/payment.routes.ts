import { UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate } from "../../../middleware/authenticate";
import { requireRole } from "../../../middleware/require-role";
import { validateRequest } from "../../../middleware/validate-request";
import { getPayment, initiatePayment, verifyPayment } from "./payment.controller";
import {
  initiatePaymentBodySchema,
  paymentOrderParamsSchema,
  verifyPaymentBodySchema
} from "./payment.schemas";

export const paymentRouter = Router();

paymentRouter.use(authenticate, requireRole(UserRole.PATIENT));
paymentRouter.post(
  "/:orderId/payment",
  validateRequest({ params: paymentOrderParamsSchema, body: initiatePaymentBodySchema }),
  initiatePayment
);
paymentRouter.post(
  "/:orderId/payment/verify",
  validateRequest({ params: paymentOrderParamsSchema, body: verifyPaymentBodySchema }),
  verifyPayment
);
paymentRouter.get(
  "/:orderId/payment",
  validateRequest({ params: paymentOrderParamsSchema }),
  getPayment
);