import { UserRole } from "@prisma/client";
import type { RequestHandler } from "express";

import { AppError } from "../errors/app-error";

export const requireRole = (...allowedRoles: UserRole[]): RequestHandler => {
  return (request, _response, next) => {
    if (!request.user) {
      next(
        new AppError(401, "UNAUTHORIZED", "Authentication is required")
      );
      return;
    }

    if (!allowedRoles.includes(request.user.role as UserRole)) {
      next(new AppError(403, "FORBIDDEN", "You do not have permission"));
      return;
    }

    next();
  };
};