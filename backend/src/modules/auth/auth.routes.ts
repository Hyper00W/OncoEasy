import { Router } from "express";
import { z } from "zod";

import { AppError } from "../../errors/app-error";
import { createRateLimit } from "../../middleware/rate-limit";
import {
  parsePatientOtpRequest,
  parsePatientOtpVerification,
  requestPatientOtp,
  verifyPatientOtp
} from "./patient-otp";
import {
  loginProfessionalUser,
  parseProfessionalLogin
} from "./professional-login";
import {
  revokeRefreshSession,
  rotateRefreshToken
} from "./refresh-session.service";

export const authRouter = Router();

// Brakes for abuse-sensitive auth endpoints. Generous per-IP windows: the
// goal is only to make OTP-request flooding (paid WhatsApp/SMS sends) and
// password brute-force impractical, never to block normal users.
const loginRateLimit = createRateLimit({ windowMs: 15 * 60_000, max: 30 });
const otpRequestRateLimit = createRateLimit({ windowMs: 10 * 60_000, max: 10 });
// Refresh is bearer-authenticated and rotation is one-time; a modest window
// blunts token-stuffing attempts without affecting normal single-flight use.
const refreshRateLimit = createRateLimit({ windowMs: 15 * 60_000, max: 60 });

authRouter.post("/login", loginRateLimit, async (request, response, next) => {
  try {
    const { email, password } = parseProfessionalLogin(request.body);
    const result = await loginProfessionalUser(email, password);

    response.status(200).json({
      success: true,
      data: result,
      message: "Authenticated successfully"
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/patient/request-otp", otpRequestRateLimit, async (request, response, next) => {
  try {
    const { phone } = parsePatientOtpRequest(request.body);
    const result = await requestPatientOtp(phone);

    response.status(200).json({
      success: true,
      data: {
        phone,
        expiresAt: result.expiresAt.toISOString(),
        ...(result.testOtp ? { testOtp: result.testOtp } : {})
      },
      message: "OTP requested"
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/patient/verify-otp", async (request, response, next) => {
  try {
    const { phone, otp } = parsePatientOtpVerification(request.body);
    const result = await verifyPatientOtp(phone, otp);

    response.status(200).json({
      success: true,
      data: result,
      message: "Patient authenticated"
    });
  } catch (error) {
    next(error);
  }
});

// Exchanges a valid, unrevoked, unexpired refresh token for a new access token
// plus a rotated refresh token. Opaque tokens only; no user data is returned.
authRouter.post("/refresh", refreshRateLimit, async (request, response, next) => {
  try {
    const { refreshToken } = parseRefreshBody(request.body);
    const result = await rotateRefreshToken(refreshToken);

    response.status(200).json({
      success: true,
      data: result,
      message: "Session refreshed"
    });
  } catch (error) {
    next(error);
  }
});

// Revokes the presented refresh session. Idempotent and unauthenticated so a
// stale client can always complete cleanup; an attacker gains nothing by
// revoking a token they would otherwise be unable to use after logout anyway.
authRouter.post("/logout", async (request, response, next) => {
  try {
    const { refreshToken } = parseLogoutBody(request.body);
    await revokeRefreshSession(refreshToken);

    response.status(200).json({
      success: true,
      data: { revoked: true },
      message: "Signed out"
    });
  } catch (error) {
    next(error);
  }
});

const refreshSchema = z.object({
  refreshToken: z.string().trim().min(1)
}).strict();

const logoutSchema = z.object({
  refreshToken: z.string().trim().min(1)
}).strict();

function parseRefreshBody(body: unknown): { refreshToken: string } {
  const parsed = refreshSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "A refresh token is required");
  }
  return parsed.data;
}

function parseLogoutBody(body: unknown): { refreshToken: string } {
  const parsed = logoutSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "A refresh token is required");
  }
  return parsed.data;
}
