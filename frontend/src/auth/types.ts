export type UserRole =
  | "PATIENT"
  | "DOCTOR"
  | "PHARMACIST"
  | "OPS_ADMIN"
  | "DELIVERY_AGENT";

export type AuthUser = {
  id: string;
  fullName?: string;
  email?: string;
  phone?: string | null;
  role: UserRole;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  onboardingRequired?: boolean;
};

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  onboardingRequired?: boolean;
};

export type OtpRequestResponse = {
  phone: string;
  expiresAt: string;
};

export type PatientProfileResponse = {
  user: AuthUser;
  onboardingCompleted: boolean;
};
