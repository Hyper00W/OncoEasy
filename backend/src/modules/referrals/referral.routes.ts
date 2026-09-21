import { UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/require-role";
import { validateRequest } from "../../middleware/validate-request";
import {
  addPatientReferralToCart,
  createReferral,
  getPatientReferralByToken,
  getReferral,
  listReferrals
} from "./referral.controller";
import { referralCreateSchema, referralIdParamsSchema, referralTokenParamsSchema } from "./referral.schemas";
import { adminReferralListQuerySchema } from "./referral.admin.schemas";
import { getAdmin, listAdmin } from "./referral.controller";

export const referralRouter = Router();

referralRouter.post(
  "/",
  authenticate,
  requireRole(UserRole.DOCTOR),
  validateRequest({ body: referralCreateSchema }),
  createReferral
);

export const adminReferralRouter = Router();
adminReferralRouter.use(authenticate, requireRole(UserRole.OPS_ADMIN));
adminReferralRouter.get("/", validateRequest({ query: adminReferralListQuerySchema }), listAdmin);
adminReferralRouter.get("/:referralId", validateRequest({ params: referralIdParamsSchema }), getAdmin);
referralRouter.get(
  "/",
  authenticate,
  requireRole(UserRole.DOCTOR),
  listReferrals
);
referralRouter.get(
  "/:referralId",
  authenticate,
  requireRole(UserRole.DOCTOR),
  validateRequest({ params: referralIdParamsSchema }),
  getReferral
);
referralRouter.get(
  "/access/:accessToken",
  authenticate,
  requireRole(UserRole.PATIENT),
  validateRequest({ params: referralTokenParamsSchema }),
  getPatientReferralByToken
);
referralRouter.post(
  "/access/:accessToken/cart",
  authenticate,
  requireRole(UserRole.PATIENT),
  validateRequest({ params: referralTokenParamsSchema }),
  addPatientReferralToCart
);
