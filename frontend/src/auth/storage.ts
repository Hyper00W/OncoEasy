import type { AuthSession } from "./types";

const SESSION_KEY = "oncoeasy:auth-session:v1";
const PENDING_PHONE_KEY = "oncoeasy:pending-patient-phone:v1";
/**
 * Dev/test only — the backend echoes the OTP while running with NODE_ENV=test.
 * Held in sessionStorage (tab-scoped) just long enough to cross from the phone
 * page to the OTP page, and only ever written when the backend actually
 * returned a testOtp, which production backends never do.
 */
const PENDING_DEV_OTP_KEY = "oncoeasy:pending-dev-otp:v1";

export function readAuthSession(): AuthSession | null {
  try {
    const value = localStorage.getItem(SESSION_KEY);
    if (!value) {
      return null;
    }

    const parsed = JSON.parse(value) as Partial<AuthSession>;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.refreshToken !== "string" ||
      !parsed.user ||
      typeof parsed.user.id !== "string" ||
      typeof parsed.user.role !== "string"
    ) {
      return null;
    }

    return parsed as AuthSession;
  } catch {
    return null;
  }
}

export function writeAuthSession(session: AuthSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearAuthSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function writePendingPhone(phone: string): void {
  sessionStorage.setItem(PENDING_PHONE_KEY, phone);
}

export function readPendingPhone(): string | null {
  return sessionStorage.getItem(PENDING_PHONE_KEY);
}

export function clearPendingPhone(): void {
  sessionStorage.removeItem(PENDING_PHONE_KEY);
}

export function writePendingDevOtp(otp: string | null): void {
  if (otp) {
    sessionStorage.setItem(PENDING_DEV_OTP_KEY, otp);
  } else {
    sessionStorage.removeItem(PENDING_DEV_OTP_KEY);
  }
}

export function readPendingDevOtp(): string | null {
  return sessionStorage.getItem(PENDING_DEV_OTP_KEY);
}

export function clearPendingDevOtp(): void {
  sessionStorage.removeItem(PENDING_DEV_OTP_KEY);
}
