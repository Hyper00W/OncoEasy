import type { ErrorRequestHandler } from "express";

import { AppError } from "../errors/app-error";

export const errorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next
) => {
  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message
      }
    });
    return;
  }

  if (isMalformedJsonError(error)) {
    response.status(400).json({
      success: false,
      error: {
        code: "MALFORMED_JSON",
        message: "Request body contains invalid JSON"
      }
    });
    return;
  }

  response.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred"
    }
  });
};

function isMalformedJsonError(error: unknown): error is SyntaxError & { status: number } {
  return (
    error instanceof SyntaxError &&
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 400
  );
}