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
  consultationType: "IN_CLINIC" | "PHONE";
  status: string;
  doctorName: string | null;
} | null;

export type DashboardOrder = {
  orderId: string;
  status: string;
  totalAmount: string;
  currency: string;
  itemCount: number;
};

export type DashboardReferral = {
  referralId: string;
  status: string;
  createdAt: string;
} | null;

export type DashboardLabTest = {
  bookingId: string;
  testId: string;
  name: string;
  status: string;
  preferredDate: string;
};

export type DashboardPapStatus = {
  applicationId: string;
  status: string;
  programName: string;
  updatedAt: string;
} | null;

export type PatientDashboard = {
  nextStep: DashboardNextStep | null;
  upcomingAppointment: DashboardAppointment;
  activeOrders: DashboardOrder[];
  referral: DashboardReferral;
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
