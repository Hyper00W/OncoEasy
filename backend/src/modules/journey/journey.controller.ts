import type { RequestHandler } from "express";
import { JourneyStageKey } from "@prisma/client";

import {
  advancePatientJourney,
  getAdminJourneyStage,
  getPatientJourney,
  getPatientJourneyStage,
  listAdminJourneyStages,
  updateAdminJourneyStage
} from "./journey.service";
import type { UpdateJourneyContentInput, UpdateJourneyStageInput } from "./journey.schemas";

export const getJourney: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await getPatientJourney(request.user?.userId as string) }); } catch (error) { next(error); }
};

export const getJourneyStage: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await getPatientJourneyStage(request.user?.userId as string, request.params.stage as JourneyStageKey) }); } catch (error) { next(error); }
};

export const advanceJourney: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await advancePatientJourney(request.user?.userId as string, (request.body as UpdateJourneyStageInput).stage as JourneyStageKey) }); } catch (error) { next(error); }
};

export const listAdminStages: RequestHandler = async (_request, response, next) => {
  try { response.status(200).json({ success: true, data: await listAdminJourneyStages() }); } catch (error) { next(error); }
};

export const getAdminStage: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await getAdminJourneyStage(request.params.stage as JourneyStageKey) }); } catch (error) { next(error); }
};

export const updateAdminStage: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await updateAdminJourneyStage(request.params.stage as JourneyStageKey, request.body as UpdateJourneyContentInput) }); } catch (error) { next(error); }
};
