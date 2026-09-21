import { JourneyStageKey, UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/require-role";
import { validateRequest } from "../../middleware/validate-request";
import { advanceJourney, getAdminStage, getJourney, getJourneyStage, listAdminStages, updateAdminStage } from "./journey.controller";
import { journeyStageParamSchema, updateJourneyContentSchema, updateJourneyStageSchema } from "./journey.schemas";

export const patientJourneyRouter = Router();
patientJourneyRouter.use(authenticate, requireRole(UserRole.PATIENT));
patientJourneyRouter.get("/", getJourney);
patientJourneyRouter.get("/stages/:stage", validateRequest({ params: journeyStageParamSchema }), getJourneyStage);
patientJourneyRouter.patch("/stage", validateRequest({ body: updateJourneyStageSchema }), advanceJourney);

export const adminJourneyRouter = Router();
adminJourneyRouter.use(authenticate, requireRole(UserRole.OPS_ADMIN));
adminJourneyRouter.get("/stages", listAdminStages);
adminJourneyRouter.get("/stages/:stage", validateRequest({ params: journeyStageParamSchema }), getAdminStage);
adminJourneyRouter.patch("/stages/:stage", validateRequest({ params: journeyStageParamSchema, body: updateJourneyContentSchema }), updateAdminStage);
