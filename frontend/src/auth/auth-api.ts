import { apiClient } from "../api/client";
import type {
  AuthResponse,
  OtpRequestResponse,
  PatientProfileResponse
} from "./types";

const PATIENT_REQUEST_OTP_PATH = "/api/v1/auth/patient/request-otp";
const PATIENT_VERIFY_OTP_PATH = "/api/v1/auth/patient/verify-otp";
const PROFESSIONAL_LOGIN_PATH = "/api/v1/auth/login";
const PATIENT_PROFILE_PATH = "/api/v1/patient/me";
const PATIENT_ONBOARDING_PATH = "/api/v1/patient/onboarding";

type ApiEnvelope<T> = {
  success: true;
  data: T;
  message: string;
};

export function requestPatientOtp(phone: string): Promise<OtpRequestResponse> {
  return apiClient
    .post<ApiEnvelope<OtpRequestResponse>>(PATIENT_REQUEST_OTP_PATH, { phone })
    .then((response) => response.data);
}

export function verifyPatientOtp(
  phone: string,
  otp: string
): Promise<AuthResponse> {
  return apiClient
    .post<ApiEnvelope<AuthResponse>>(PATIENT_VERIFY_OTP_PATH, { phone, otp })
    .then((response) => response.data);
}

export function loginWithPassword(
  email: string,
  password: string
): Promise<AuthResponse> {
  return apiClient
    .post<ApiEnvelope<AuthResponse>>(PROFESSIONAL_LOGIN_PATH, { email, password })
    .then((response) => response.data);
}

export function getPatientProfile(): Promise<PatientProfileResponse> {
  return apiClient
    .get<ApiEnvelope<PatientProfileResponse>>(PATIENT_PROFILE_PATH)
    .then((response) => response.data);
}

export function completePatientOnboarding(input: {
  fullName: string;
  diagnosisStage: string;
  city: string;
}): Promise<PatientProfileResponse> {
  return apiClient
    .patch<ApiEnvelope<PatientProfileResponse>>(PATIENT_ONBOARDING_PATH, input)
    .then((response) => response.data);
}
