import { UserRole } from "@prisma/client";
import multer from "multer";
import { Router } from "express";

import { env } from "../../../config/env";
import { AppError } from "../../../errors/app-error";
import { authenticate } from "../../../middleware/authenticate";
import { requireRole } from "../../../middleware/require-role";
import { validateRequest } from "../../../middleware/validate-request";
import {
  assignDelivery, delivered, failed, getAssigned, listAssigned, outForDelivery, uploadProof
} from "./delivery-agent.controller";
import { adminDeliveryListQuerySchema, assignDeliverySchema, deliveryParamsSchema, failDeliverySchema } from "./delivery-agent.schemas";
import { getAdmin, listAdmin } from "./delivery-agent.controller";

const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.DELIVERY_PROOF_MAX_FILE_SIZE_BYTES },
  fileFilter: (_request, file, callback) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) callback(null, true);
    else callback(new AppError(400, "UNSUPPORTED_FILE_TYPE", "Proof must be a JPEG, PNG, or WEBP image"));
  }
});

export const deliveryAgentRouter = Router();

export const adminDeliveryRouter = Router();
adminDeliveryRouter.use(authenticate, requireRole(UserRole.OPS_ADMIN));
adminDeliveryRouter.get("/", validateRequest({ query: adminDeliveryListQuerySchema }), listAdmin);
adminDeliveryRouter.get("/:deliveryId", validateRequest({ params: deliveryParamsSchema }), getAdmin);

deliveryAgentRouter.post(
  "/:deliveryId/assign",
  authenticate,
  requireRole(UserRole.PHARMACIST, UserRole.OPS_ADMIN),
  validateRequest({ params: deliveryParamsSchema, body: assignDeliverySchema }),
  assignDelivery
);
deliveryAgentRouter.get(
  "/assigned",
  authenticate,
  requireRole(UserRole.DELIVERY_AGENT),
  listAssigned
);
deliveryAgentRouter.get(
  "/:deliveryId",
  authenticate,
  requireRole(UserRole.DELIVERY_AGENT),
  validateRequest({ params: deliveryParamsSchema }),
  getAssigned
);
deliveryAgentRouter.patch(
  "/:deliveryId/out-for-delivery",
  authenticate,
  requireRole(UserRole.DELIVERY_AGENT),
  validateRequest({ params: deliveryParamsSchema }),
  outForDelivery
);
deliveryAgentRouter.patch(
  "/:deliveryId/delivered",
  authenticate,
  requireRole(UserRole.DELIVERY_AGENT),
  validateRequest({ params: deliveryParamsSchema }),
  delivered
);
deliveryAgentRouter.patch(
  "/:deliveryId/failed",
  authenticate,
  requireRole(UserRole.DELIVERY_AGENT),
  validateRequest({ params: deliveryParamsSchema, body: failDeliverySchema }),
  failed
);
deliveryAgentRouter.post(
  "/:deliveryId/proofs",
  authenticate,
  requireRole(UserRole.DELIVERY_AGENT),
  validateRequest({ params: deliveryParamsSchema }),
  proofUpload.single("file"),
  uploadProof
);