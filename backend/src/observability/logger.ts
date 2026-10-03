/**
 * Structured application logging (Phase 4.7).
 *
 * A minimal, dependency-free structured logger. Every meaningful log line is
 * emitted as a single-line JSON object so production log collectors can index
 * fields without parsing conventions.
 *
 * Security invariants (Phase 4.7):
 * - values whose keys look secret-bearing (password, otp, token, authorization,
 *   cookie, api key, secret, signature...) are replaced with "[REDACTED]"
 * - errors are logged through `errorToFields`, which keeps only the safe error
 *   shape (name/message category/code/stack-in-dev) and never provider payloads
 * - request bodies, message bodies, and file contents are never passed here
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

/** Keys that must never reach a log line with their original value. */
const SENSITIVE_KEY_PATTERN =
  /(password|passphrase|passwd|otp|onetimecode|token|authorization|auth|cookie|secret|api[-_]?key|apikey|access[-_]?key|secret[-_]?access[-_]?key|signature|credential|session[-_]?id|refresh)/i;

export type LogFields = Record<string, unknown>;

function currentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "").trim().toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  // Production defaults to info; development/test default to debug so local
  // diagnostics stay rich without configuration.
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function redactValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Error) {
    return errorToFields(value);
  }
  if (depth >= 4) {
    return "[TRUNCATED]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactValue(item, depth + 1);
    }
    return result;
  }
  if (typeof value === "string" && value.length > 500) {
    return `${value.slice(0, 500)}…[TRUNCATED]`;
  }
  return value;
}

export function redactFields(fields: LogFields | undefined): LogFields | undefined {
  if (!fields) {
    return undefined;
  }
  return redactValue(fields, 0) as LogFields;
}

/**
 * Converts an unknown thrown value into safe log fields. Only the error name,
 * message, and a category/code when present are kept. Stack traces are only
 * included outside production so local debugging stays useful.
 */
export function errorToFields(error: unknown): LogFields {
  if (error instanceof Error) {
    const fields: LogFields = {
      errorName: error.name,
      errorMessage: error.message
    };
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") {
      fields.errorCode = code;
    }
    if (process.env.NODE_ENV !== "production") {
      fields.stack = error.stack;
    }
    return fields;
  }
  return { errorName: "UnknownError", errorMessage: String(error) };
}

function emit(level: LogLevel, module: string, event: string, fields?: LogFields): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel()]) {
    return;
  }

  const entry: LogFields = {
    timestamp: new Date().toISOString(),
    level,
    module,
    event,
    ...redactFields(fields)
  };

  try {
    const line = JSON.stringify(entry, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    );
    if (level === "error") {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  } catch (_error) {
    // Logging must never take the process down (e.g. circular structures).
  }
}

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(boundFields: LogFields): Logger;
}

export function createLogger(module: string, boundFields: LogFields = {}): Logger {
  const emitWith = (level: LogLevel, event: string, fields?: LogFields) =>
    emit(level, module, event, { ...boundFields, ...fields });

  return {
    debug: (event, fields) => emitWith("debug", event, fields),
    info: (event, fields) => emitWith("info", event, fields),
    warn: (event, fields) => emitWith("warn", event, fields),
    error: (event, fields) => emitWith("error", event, fields),
    child: (extraFields) => createLogger(module, { ...boundFields, ...extraFields })
  };
}

export const logger = createLogger("app");
