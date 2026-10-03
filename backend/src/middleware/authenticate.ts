import type { RequestHandler } from "express";

import { AppError } from "../errors/app-error";
import { setRequestActor } from "../observability/request-context";
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
    const payload = verifyAccessToken(token);
    request.user = payload;
    // The authenticated actor joins the request context so audit records and
    // structured logs can attribute actions to a user/role safely.
    setRequestActor({ userId: payload.userId, role: payload.role });
    next();
  } catch (_error) {
    next(new AppError(401, "UNAUTHORIZED", "Invalid or expired access token"));
  }
};