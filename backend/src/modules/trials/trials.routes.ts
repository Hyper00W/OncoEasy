import { UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/require-role";
import { validateRequest } from "../../middleware/validate-request";
import { create, createInterest, getAdmin, getPublished, listAdmin, listAdminInterest, listInterests, listPublished, publish, update, updateInterest } from "./trials.controller";
import { createInterestSchema, createTrialSchema, interestIdParamsSchema, publishTrialSchema, trialIdParamsSchema, trialListQuerySchema, updateInterestStatusSchema, updateTrialSchema } from "./trials.schemas";

export const trialsRouter = Router();
trialsRouter.use(authenticate, requireRole(UserRole.PATIENT));
trialsRouter.get("/interests", listInterests);
trialsRouter.get("/", validateRequest({ query: trialListQuerySchema }), listPublished);
trialsRouter.get("/:trialId", validateRequest({ params: trialIdParamsSchema }), getPublished);
trialsRouter.post("/:trialId/interest", validateRequest({ params: trialIdParamsSchema, body: createInterestSchema }), createInterest);

export const adminTrialsRouter = Router();
adminTrialsRouter.use(authenticate, requireRole(UserRole.OPS_ADMIN, UserRole.OWNER));
adminTrialsRouter.get("/trial-interests", validateRequest({ query: trialListQuerySchema }), listAdminInterest);
adminTrialsRouter.patch("/trial-interests/:interestId/status", validateRequest({ params: interestIdParamsSchema, body: updateInterestStatusSchema }), updateInterest);
adminTrialsRouter.get("/trials", validateRequest({ query: trialListQuerySchema }), listAdmin);
adminTrialsRouter.get("/trials/:trialId", validateRequest({ params: trialIdParamsSchema }), getAdmin);
adminTrialsRouter.post("/trials", validateRequest({ body: createTrialSchema }), create);
adminTrialsRouter.patch("/trials/:trialId", validateRequest({ params: trialIdParamsSchema, body: updateTrialSchema }), update);
adminTrialsRouter.patch("/trials/:trialId/publish", validateRequest({ params: trialIdParamsSchema, body: publishTrialSchema }), publish);
