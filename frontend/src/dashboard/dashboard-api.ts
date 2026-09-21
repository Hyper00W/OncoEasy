import { apiClient } from "../api/client";

export type DashboardNextStep = {
  type: "COMPLETE_PROFILE";
  label: string;
};

export type DashboardQuickLink = {
  key: string;
  label: string;
  path: string;
  available: boolean;
};

export type DashboardAppointment = {
  appointmentId: string;
  scheduledAt: string;
  status: string;
  doctor?: { doctorId: string; fullName: string };
} | null;

export type DashboardOrder = {
  id: string;
  status: string;
  totalAmount?: string;
} & Record<string, unknown>;

export type DashboardReferral = {
  referralId: string;
  status: string;
} & Record<string, unknown>;

export type DashboardLabTest = {
  bookingId?: string;
  testId?: string;
  name?: string;
  status?: string;
} & Record<string, unknown>;

export type DashboardPapStatus = {
  status: string;
} | null;

export type PatientDashboard = {
  nextStep: DashboardNextStep | null;
  upcomingAppointment: DashboardAppointment;
  activeOrders: DashboardOrder[];
  referral: DashboardReferral | null;
  labTests: DashboardLabTest[];
  papStatus: DashboardPapStatus;
  quickLinks: DashboardQuickLink[];
};

type DashboardEnvelope = {
  success: true;
  data: PatientDashboard;
  message: string;
};

export function getPatientDashboard(): Promise<PatientDashboard> {
  return apiClient
    .get<DashboardEnvelope>("/api/v1/patient/dashboard")
    .then((response) => response.data);
}
