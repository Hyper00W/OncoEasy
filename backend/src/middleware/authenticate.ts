import type { RequestHandler } from "express";

import { AppError } from "../errors/app-error";
import { verifyAccessToken } from "../services/jwt";

export const authenticate: RequestHandler = (request, _response, next) => {
  const authorization = request.headers.authorization;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (!token) {
    next(
      new AppError(401, "UNAUTHORIZED", "Authentication is required")
    );
    return;
  }

  try {
    request.user = verifyAccessToken(token);
    next();
  } catch (_error) {
    next(new AppError(401, "UNAUTHORIZED", "Invalid or expired access token"));
  }
};