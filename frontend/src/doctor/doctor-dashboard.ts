import { ApiError } from "../api/client";
import {
  getDoctorReferral,
  listDoctorReferrals,
  type CreatedReferral,
  type Referral
} from "../referrals/referral-api";
import {
  listDoctorAppointments,
  type Appointment
} from "../consultations/consultation-api";

export type { Appointment, Referral, CreatedReferral };

export type DoctorWorkspaceData = {
  appointments: Appointment[];
  referrals: Referral[];
};

export function loadDoctorWorkspace(): Promise<DoctorWorkspaceData> {
  return Promise.all([listDoctorAppointments(), listDoctorReferrals()]).then(
    ([appointments, referrals]) => ({ appointments, referrals })
  );
}

export { getDoctorReferral };

export const UPCOMING_APPOINTMENT_STATUSES = ["PENDING", "CONFIRMED"] as const;

export function isUpcomingAppointment(appointment: Appointment): boolean {
  return (
    UPCOMING_APPOINTMENT_STATUSES.includes(
      appointment.status as (typeof UPCOMING_APPOINTMENT_STATUSES)[number]
    ) && new Date(appointment.endsAt).getTime() >= Date.now()
  );
}

export function isActionRequiredAppointment(appointment: Appointment): boolean {
  return (
    appointment.status === "PENDING" && new Date(appointment.endsAt).getTime() >= Date.now()
  );
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function isReferralActive(referral: Referral): boolean {
  return referral.status === "SENT" || referral.status === "VIEWED";
}
