import type { RequestHandler } from "express";

import { getAdminOverview } from "./admin.service";

export const overview: RequestHandler = async (_request, response, next) => {
  try {
    response.status(200).json({ success: true, data: await getAdminOverview() });
  } catch (error) {
    next(error);
  }
};