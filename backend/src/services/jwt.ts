import jwt, { type SignOptions } from "jsonwebtoken";

import { env } from "../config/env";
import { AppError } from "../errors/app-error";

export type TokenPayload = {
  userId: string;
  role: string;
};

const signOptions = (expiresIn: string): SignOptions => ({
  expiresIn: expiresIn as SignOptions["expiresIn"]
});

export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(
    payload,
    env.JWT_ACCESS_SECRET,
    signOptions(env.JWT_ACCESS_EXPIRES_IN)
  );
}

export function generateRefreshToken(payload: TokenPayload): string {
  return jwt.sign(
    payload,
    env.JWT_REFRESH_SECRET,
    signOptions(env.JWT_REFRESH_EXPIRES_IN)
  );
}

export function verifyAccessToken(token: string): TokenPayload {
  return verifyToken(token, env.JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token: string): TokenPayload {
  return verifyToken(token, env.JWT_REFRESH_SECRET);
}

function verifyToken(token: string, secret: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, secret);

    if (!isTokenPayload(decoded)) {
      throw new AppError(401, "INVALID_TOKEN", "Invalid token");
    }

    return decoded;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(401, "INVALID_TOKEN", "Invalid token");
  }
}

function isTokenPayload(value: string | jwt.JwtPayload): value is TokenPayload {
  return (
    typeof value === "object" &&
    typeof value.userId === "string" &&
    typeof value.role === "string"
  );
}