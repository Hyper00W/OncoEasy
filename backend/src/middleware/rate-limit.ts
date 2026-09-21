import type { RequestHandler } from "express";

import { AppError } from "../errors/app-error";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Minimal in-memory fixed-window rate limiter (no external dependency).
 *
 * Scope: brakes for expensive/abusable endpoints — professional login
 * (brute-force resistance) and patient OTP request (paid WhatsApp/SMS
 * sends). It is intentionally conservative so legitimate users are never
 * blocked in normal use.
 *
 * Limitations (accepted for the current architecture):
 * - per process instance: with multiple instances each gets its own window
 *   (no Redis/shared store exists in this codebase)
 * - client identity comes from the platform-provided x-forwarded-for header
 *   when present (hosting platforms set it authoritatively), falling back to
 *   the socket address.
 */
export function createRateLimit(options: {
  windowMs: number;
  max: number;
}): RequestHandler {
  // Periodically drop expired buckets so the map cannot grow unbounded.
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }, options.windowMs);
  cleanup.unref?.();

  return (request, _response, next) => {
    const forwarded = request.headers["x-forwarded-for"];
    const clientIp =
      (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined) ||
      request.ip ||
      "unknown";
    const now = Date.now();
    const bucket = buckets.get(clientIp);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(clientIp, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      next(
        new AppError(
          429,
          "RATE_LIMITED",
          "Too many requests. Please try again later."
        )
      );
      return;
    }
    next();
  };
}
