import type { RequestHandler } from "express";

import { getAnalyticsOverview, listAnalyticsEvents } from "./analytics.service";
import type { AnalyticsDateRange, AnalyticsEventsQuery } from "./analytics.schemas";

export const overview: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await getAnalyticsOverview(request.query as unknown as AnalyticsDateRange) }); } catch (error) { next(error); } };
export const events: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await listAnalyticsEvents(request.query as unknown as AnalyticsEventsQuery) }); } catch (error) { next(error); } };