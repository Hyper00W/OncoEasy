import type { RequestHandler } from "express";

import { createLogger } from "./logger";
import {
  REQUEST_ID_HEADER_NAME,
  extractIncomingRequestId,
  generateRequestId,
  requestLogFields,
  runWithRequestContext,
  setRequestActor
} from "./request-context";

const requestLogger = createLogger("http");

/** Routes that must not produce per-request lifecycle logs (health probes). */
const QUIET_ROUTES = new Set(["/health", "/health/ready", "/health/live"]);

/**
 * Assigns a correlation ID to every request, echoes it on the response, and
 * runs the whole handler chain inside the request context so services and
 * integrations can log with correlation without parameter threading.
 *
 * An incoming `X-Request-Id` is honored only when it is a safe opaque token;
 * otherwise a server-side UUID is generated. User IDs, phone numbers, emails,
 * and tokens are never accepted as request IDs.
 */
export const requestContextMiddleware: RequestHandler = (request, response, next) => {
  const requestId = extractIncomingRequestId(request.headers) ?? generateRequestId();
  response.setHeader(REQUEST_ID_HEADER_NAME, requestId);

  runWithRequestContext(
    {
      requestId,
      actor: null,
      route: request.path,
      method: request.method
    },
    () => next()
  );
};

/**
 * Request lifecycle logging at the backend boundary.
 *
 * Volume policy (Phase 4.7): successful GET requests are not logged (they
 * would dominate log volume without diagnostic value); successful mutations
 * are logged at debug level; 4xx failures log at warn and 5xx at error so
 * every failure is diagnosable. Health probes stay quiet.
 */
export const requestLoggingMiddleware: RequestHandler = (request, response, next) => {
  const startedAt = process.hrtime.bigint();
  const { method, path } = request;
  const quiet = QUIET_ROUTES.has(path);

  response.on("finish", () => {
    if (quiet) {
      return;
    }

    const status = response.statusCode;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const fields = {
      ...requestLogFields(),
      method,
      path,
      status,
      durationMs: Math.round(durationMs * 100) / 100
    };

    if (status >= 500) {
      requestLogger.error("http_request_failed", fields);
    } else if (status >= 400) {
      requestLogger.warn("http_request_rejected", fields);
    } else if (method !== "GET") {
      requestLogger.debug("http_request_completed", fields);
    }
  });

  next();
};
