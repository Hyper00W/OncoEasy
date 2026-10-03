import type { ErrorRequestHandler } from "express";

import { AppError } from "../errors/app-error";
import { describeError, errorLogger } from "../observability/error-diagnostics";
import { getRequestContext, REQUEST_ID_HEADER_NAME } from "../observability/request-context";

export const errorHandler: ErrorRequestHandler = (
  error,
  request,
  response,
  _next
) => {
  // Safe, correlated diagnostics: one log line per error with the request ID,
  // the failing route, and a safe error category — never a stack trace,
  // provider payload, or database detail.
  const diagnostics = describeError(error);
  const route = request.route?.path ?? request.path;
  const logFields = {
    ...diagnostics.fields,
    method: request.method,
    path: route
  };
  if (diagnostics.level === "error") {
    errorLogger.error("http_request_error", logFields);
  } else {
    errorLogger.warn("http_request_rejected", logFields);
  }

  const requestId = getRequestContext()?.requestId ?? null;
  if (requestId) {
    response.setHeader(REQUEST_ID_HEADER_NAME, requestId);
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(requestId ? { requestId } : {})
      }
    });
    return;
  }

  if (isMalformedJsonError(error)) {
    response.status(400).json({
      success: false,
      error: {
        code: "MALFORMED_JSON",
        message: "Request body contains invalid JSON",
        ...(requestId ? { requestId } : {})
      }
    });
    return;
  }

  response.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
      ...(requestId ? { requestId } : {})
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