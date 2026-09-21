import { apiClient } from "../api/client";

type Envelope<T> = { success: true; data: T };

export type Doctor = { doctorId: string; fullName: string };
export type Availability = { availabilityId: string; startsAt: string; endsAt: string; isActive: boolean; booked: boolean };
export type Appointment = {
  appointmentId: string;
  doctor: Doctor;
  patient: { patientId: string; fullName: string };
  availabilityId: string;
  consultationType: "IN_CLINIC" | "PHONE";
  scheduledAt: string;
  endsAt: string;
  status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  patientNotes: string | null;
  cancellationReason: string | null;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const data = <T>(request: Promise<Envelope<T>>): Promise<T> => request.then((response) => response.data);

export function listDoctors() { return data(apiClient.get<Envelope<Doctor[]>>("/api/v1/consultations/doctors")); }
export function listAvailability(doctorId: string) { return data(apiClient.get<Envelope<Availability[]>>(`/api/v1/consultations/doctors/${doctorId}/availability`)); }
export function bookAppointment(input: { availabilityId: string; consultationType: "IN_CLINIC" | "PHONE"; patientNotes?: string }) { return data(apiClient.post<Envelope<Appointment>>("/api/v1/consultations/appointments", input)); }
export function listPatientAppointments() { return data(apiClient.get<Envelope<Appointment[]>>("/api/v1/consultations/appointments")); }
export function getPatientAppointment(id: string) { return data(apiClient.get<Envelope<Appointment>>(`/api/v1/consultations/appointments/${id}`)); }
export function cancelPatientAppointment(id: string, reason?: string) { return data(apiClient.patch<Envelope<Appointment>>(`/api/v1/consultations/appointments/${id}/cancel`, reason ? { reason } : {})); }
export function createAvailability(startsAt: string, endsAt: string) { return data(apiClient.post<Envelope<Availability>>("/api/v1/consultations/doctor/availability", { startsAt, endsAt })); }
export function listOwnAvailability() { return data(apiClient.get<Envelope<Availability[]>>("/api/v1/consultations/doctor/availability")); }
export function deactivateAvailability(id: string) { return data(apiClient.patch<Envelope<Availability>>(`/api/v1/consultations/doctor/availability/${id}/deactivate`)); }
export function listDoctorAppointments() { return data(apiClient.get<Envelope<Appointment[]>>("/api/v1/consultations/doctor/appointments")); }
export function getDoctorAppointment(id: string) { return data(apiClient.get<Envelope<Appointment>>(`/api/v1/consultations/doctor/appointments/${id}`)); }
export function confirmAppointment(id: string) { return data(apiClient.patch<Envelope<Appointment>>(`/api/v1/consultations/doctor/appointments/${id}/confirm`)); }
export function completeAppointment(id: string) { return data(apiClient.patch<Envelope<Appointment>>(`/api/v1/consultations/doctor/appointments/${id}/complete`)); }
export function cancelDoctorAppointment(id: string, reason: string) { return data(apiClient.patch<Envelope<Appointment>>(`/api/v1/consultations/doctor/appointments/${id}/cancel`, { reason })); }
