import { randomInt } from "node:crypto";

import { UserRole } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../../database/prisma";
import { AppError } from "../../errors/app-error";
import {
  generateAccessToken,
  generateRefreshToken
} from "../../services/jwt";
import { hashPassword, verifyPassword } from "../../services/password";

const OTP_TTL_MS = 60_000;
const MAX_VERIFICATION_ATTEMPTS = 5;
const REQUEST_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 3;

const phoneSchema = z.string().trim().min(1, "Phone number is required");
const verifyOtpSchema = z.object({
  phone: phoneSchema,
  otp: z.string().regex(/^\d{4}$/, "OTP must be exactly 4 digits")
});

const requestTimesByPhone = new Map<string, number[]>();

export type PatientOtpRequest = {
  phone: string;
};

export type PatientOtpVerification = {
  phone: string;
  otp: string;
};

export function normalizePhone(phone: string): string {
  const compactPhone = phone.replace(/[\s().-]/g, "");
  const internationalPhone = compactPhone.startsWith("00")
    ? `+${compactPhone.slice(2)}`
    : compactPhone;

  if (!/^\+[1-9]\d{7,14}$/.test(internationalPhone)) {
    throw new AppError(
      400,
      "INVALID_PHONE",
      "Phone number must use international format"
    );
  }

  return internationalPhone;
}

export function parsePatientOtpRequest(body: unknown): PatientOtpRequest {
  const parsed = z.object({ phone: phoneSchema }).safeParse(body);

  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "A valid phone number is required");
  }

  return { phone: normalizePhone(parsed.data.phone) };
}

export function parsePatientOtpVerification(
  body: unknown
): PatientOtpVerification {
  const parsed = verifyOtpSchema.safeParse(body);

  if (!parsed.success) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Phone number and a 4-digit OTP are required"
    );
  }

  return {
    phone: normalizePhone(parsed.data.phone),
    otp: parsed.data.otp
  };
}

export async function requestPatientOtp(phone: string): Promise<{
  expiresAt: Date;
  testOtp?: string;
}> {
  enforceRequestRateLimit(phone);

  const otp = randomInt(0, 10_000).toString().padStart(4, "0");
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  const codeHash = await hashPassword(otp);

  await prisma.patientOtpChallenge.create({
    data: {
      phone,
      codeHash,
      expiresAt
    }
  });

  return {
    expiresAt,
    ...(process.env.NODE_ENV === "test" ? { testOtp: otp } : {})
  };
}

export async function verifyPatientOtp(phone: string, otp: string): Promise<{
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    phone: string | null;
    role: UserRole;
  };
  onboardingRequired: boolean;
}> {
  const challenge = await prisma.patientOtpChallenge.findFirst({
    where: {
      phone
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  if (!challenge) {
    throw invalidOtpError();
  }

  if (challenge.consumedAt) {
    throw new AppError(400, "OTP_ALREADY_CONSUMED", "This OTP has already been used");
  }

  if (challenge.expiresAt.getTime() <= Date.now()) {
    throw new AppError(400, "OTP_EXPIRED", "This OTP has expired");
  }

  if (challenge.attempts >= MAX_VERIFICATION_ATTEMPTS) {
    throw new AppError(
      429,
      "OTP_ATTEMPTS_EXCEEDED",
      "Too many incorrect OTP attempts"
    );
  }

  const isValid = await verifyPassword(otp, challenge.codeHash);
  if (!isValid) {
    const updated = await prisma.patientOtpChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        attempts: { lt: MAX_VERIFICATION_ATTEMPTS }
      },
      data: {
        attempts: { increment: 1 }
      }
    });

    if (updated.count === 0) {
      throw new AppError(
        429,
        "OTP_ATTEMPTS_EXCEEDED",
        "Too many incorrect OTP attempts"
      );
    }

    throw invalidOtpError();
  }

  await prisma.patientOtpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() }
  });

  let user = await prisma.user.findUnique({ where: { phone } });

  if (user && user.role !== UserRole.PATIENT) {
    throw new AppError(409, "PHONE_NOT_AVAILABLE", "This phone cannot be used for patient access");
  }

  if (!user) {
    user = await prisma.user.create({
      data: {
        fullName: "Pending onboarding",
        phone,
        role: UserRole.PATIENT,
        isVerified: true
      }
    });
  } else if (!user.isVerified) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true }
    });
  }

  if (!user.isActive) {
    throw new AppError(403, "ACCOUNT_INACTIVE", "This account is inactive");
  }

  const tokenPayload = { userId: user.id, role: user.role };

  return {
    accessToken: generateAccessToken(tokenPayload),
    refreshToken: generateRefreshToken(tokenPayload),
    user: {
      id: user.id,
      phone: user.phone,
      role: user.role
    },
    onboardingRequired: user.diagnosisStage === null || user.city === null
  };
}

function enforceRequestRateLimit(phone: string): void {
  const now = Date.now();
  const recentRequests = (requestTimesByPhone.get(phone) ?? []).filter(
    (timestamp) => now - timestamp < REQUEST_WINDOW_MS
  );

  if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    throw new AppError(
      429,
      "OTP_REQUEST_RATE_LIMITED",
      "Too many OTP requests. Please try again later"
    );
  }

  recentRequests.push(now);
  requestTimesByPhone.set(phone, recentRequests);
}

function invalidOtpError(): AppError {
  return new AppError(400, "INVALID_OTP", "The OTP is invalid");
}
