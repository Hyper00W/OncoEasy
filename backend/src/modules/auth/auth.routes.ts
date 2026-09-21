import { Router } from "express";

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

export const authRouter = Router();

// Brakes for abuse-sensitive auth endpoints. Generous per-IP windows: the
// goal is only to make OTP-request flooding (paid WhatsApp/SMS sends) and
// password brute-force impractical, never to block normal users.
const loginRateLimit = createRateLimit({ windowMs: 15 * 60_000, max: 30 });
const otpRequestRateLimit = createRateLimit({ windowMs: 10 * 60_000, max: 10 });

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
