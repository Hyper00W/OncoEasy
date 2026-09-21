import { UserRole } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../../database/prisma";
import { AppError } from "../../errors/app-error";
import {
  generateAccessToken,
  generateRefreshToken
} from "../../services/jwt";
import { verifyPassword } from "../../services/password";

const invalidPasswordHash =
  "$argon2id$v=19$m=65536,p=4,t=3$Gz8H+BYo8dA37wVIkMRt+Q$B+iIVDr4tWWT8n0+H3D/MTBl9IqUwcWLz0lu+zU51PA";

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

export type ProfessionalLoginInput = {
  email: string;
  password: string;
};

export function parseProfessionalLogin(body: unknown): ProfessionalLoginInput {
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "A valid email and password are required"
    );
  }

  return {
    email: parsed.data.email.toLowerCase(),
    password: parsed.data.password
  };
}

export async function loginProfessionalUser(
  email: string,
  password: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    fullName: string;
    email: string;
    role: UserRole;
  };
}> {
  const user = await prisma.user.findUnique({ where: { email } });
  const passwordHash = user?.passwordHash ?? invalidPasswordHash;
  const passwordMatches = await verifyPassword(password, passwordHash);

  if (
    !user ||
    !passwordMatches ||
    !user.isActive ||
    user.role === UserRole.PATIENT
  ) {
    throw invalidCredentialsError();
  }

  if (
    (user.role === UserRole.DOCTOR || user.role === UserRole.PHARMACIST) &&
    !user.isVerified
  ) {
    throw new AppError(
      403,
      "ACCOUNT_NOT_APPROVED",
      "Your professional account is awaiting approval"
    );
  }

  if (
    user.role !== UserRole.DOCTOR &&
    user.role !== UserRole.PHARMACIST &&
    user.role !== UserRole.OPS_ADMIN
  ) {
    throw invalidCredentialsError();
  }

  const tokenPayload = { userId: user.id, role: user.role };

  return {
    accessToken: generateAccessToken(tokenPayload),
    refreshToken: generateRefreshToken(tokenPayload),
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email as string,
      role: user.role
    }
  };
}

function invalidCredentialsError(): AppError {
  return new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
}
