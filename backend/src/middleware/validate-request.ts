import type { RequestHandler } from "express";
import { z } from "zod";

import { AppError } from "../errors/app-error";

type RequestPart = "body" | "query" | "params";

export type RequestValidationSchemas = Partial<
  Record<RequestPart, z.ZodType>
>;

export const validateRequest = (
  schemas: RequestValidationSchemas
): RequestHandler => (request, _response, next) => {
  const validationMessages: string[] = [];

  for (const part of Object.keys(schemas) as RequestPart[]) {
    const schema = schemas[part];

    if (!schema) {
      continue;
    }

    const result = schema.safeParse(request[part]);

    if (!result.success) {
      validationMessages.push(
        ...result.error.issues.map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : part;
          return `${path}: ${issue.message}`;
        })
      );
      continue;
    }

    Object.defineProperty(request, part, {
      configurable: true,
      enumerable: true,
      value: result.data,
      writable: true
    });
  }

  if (validationMessages.length > 0) {
    next(
      new AppError(
        400,
        "VALIDATION_ERROR",
        `Request validation failed: ${validationMessages.join("; ")}`
      )
    );
    return;
  }

  next();
};