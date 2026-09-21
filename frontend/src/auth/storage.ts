import type { AuthSession } from "./types";

const SESSION_KEY = "oncoeasy:auth-session:v1";
const PENDING_PHONE_KEY = "oncoeasy:pending-patient-phone:v1";

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
