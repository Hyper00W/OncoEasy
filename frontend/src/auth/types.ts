export type UserRole =
  | "PATIENT"
  | "DOCTOR"
  | "PHARMACIST"
  | "OPS_ADMIN"
  | "DELIVERY_AGENT"
  | "OWNER";

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
  /**
   * Present only when the backend runs with NODE_ENV=test: the OTP is echoed
   * in the response so local development needs no SMS provider. The field is
   * absent in development and production builds.
   */
  testOtp?: string;
};

export type PatientProfileResponse = {
  user: AuthUser;
  onboardingCompleted: boolean;
};
