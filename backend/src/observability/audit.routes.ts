import { UserRole } from "@prisma/client";
import { Router } from "express";
import type { RequestHandler } from "express";

import { authenticate } from "../middleware/authenticate";
import { requireRole } from "../middleware/require-role";
import { validateRequest } from "../middleware/validate-request";
import { auditEventListQuerySchema, listAuditEvents } from "./audit.service";

const listAuditEventsHandler: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await listAuditEvents(request.query as unknown as Parameters<typeof listAuditEvents>[0])
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Read-only audit endpoints. Access is restricted to OPS_ADMIN through the
 * same authenticate + requireRole middleware used by every other admin route,
 * so no new authorization surface (and no bypass) is introduced. There are
 * intentionally no write, edit, or delete endpoints for audit records.
 */
export const auditRouter = Router();
auditRouter.use(authenticate, requireRole(UserRole.OPS_ADMIN, UserRole.OWNER));
auditRouter.get("/events", validateRequest({ query: auditEventListQuerySchema }), listAuditEventsHandler);
