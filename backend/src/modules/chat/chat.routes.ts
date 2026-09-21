import { UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/require-role";
import { validateRequest } from "../../middleware/validate-request";
import { adminGet, adminList, create, get, list, message } from "./chat.controller";
import { adminSessionListQuerySchema, createMessageSchema, sessionIdParamsSchema } from "./chat.schemas";

export const chatRouter = Router();
chatRouter.use(authenticate, requireRole(UserRole.PATIENT));
chatRouter.post("/sessions", create);
chatRouter.get("/sessions", list);
chatRouter.get("/sessions/:sessionId", validateRequest({ params: sessionIdParamsSchema }), get);
chatRouter.post("/sessions/:sessionId/messages", validateRequest({ params: sessionIdParamsSchema, body: createMessageSchema }), message);

export const adminChatRouter = Router();
adminChatRouter.use(authenticate, requireRole(UserRole.OPS_ADMIN));
adminChatRouter.get("/sessions", validateRequest({ query: adminSessionListQuerySchema }), adminList);
adminChatRouter.get("/sessions/:sessionId", validateRequest({ params: sessionIdParamsSchema }), adminGet);