import { createLogger, errorToFields } from "../observability/logger";
import { requestLogFields } from "../observability/request-context";
import { AppError } from "../errors/app-error";
import type { Logger } from "../observability/logger";

const logger: Logger = createLogger("http.error");

/**
 * Safe error diagnostics: every error that reaches the boundary is logged
 * once, correlated with the request ID, and reduced to a safe category before
 * it is logged or returned.
 *
 * - AppError: expected, operational — logged at warn with its stable code.
 * - Unexpected errors: logged at error WITHOUT any stack/provider/database
 *   detail beyond the safe fields from `errorToFields`; clients always receive
 *   the constant generic message.
 *
 * The safe error contract now also carries `requestId` so a user-facing error
 * can be correlated with the server-side log line (Phase 4.7 Step 11).
 */
export function describeError(error: unknown): { level: "warn" | "error"; fields: Record<string, unknown> } {
  if (error instanceof AppError) {
    return {
      level: "warn",
      fields: {
        ...requestLogFields(),
        errorCode: error.code,
        errorMessage: error.message,
        errorName: error.name
      }
    };
  }
  return {
    level: "error",
    fields: {
      ...requestLogFields(),
      ...errorToFields(error)
    }
  };
}

export { logger as errorLogger };
