type AppointmentRecord = {
  id: string;
  consultationType: string;
  scheduledAt: Date;
  endsAt: Date;
  status: string;
  patientNotes: string | null;
  cancellationReason: string | null;
  confirmedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  doctor: { id: string; fullName: string };
  patient: { id: string; fullName: string };
  availability: { id: string; startsAt: Date; endsAt: Date; isActive: boolean };
};

type AvailabilityRecord = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  appointment?: { id: string; status: string } | null;
};

export function toDoctorResponse(doctor: { id: string; fullName: string }) {
  return { doctorId: doctor.id, fullName: doctor.fullName };
}

export function toAvailabilityResponse(availability: AvailabilityRecord) {
  return {
    availabilityId: availability.id,
    startsAt: availability.startsAt.toISOString(),
    endsAt: availability.endsAt.toISOString(),
    isActive: availability.isActive,
    booked: Boolean(availability.appointment)
  };
}

export function toAppointmentResponse(appointment: AppointmentRecord) {
  return {
    appointmentId: appointment.id,
    doctor: toDoctorResponse(appointment.doctor),
    patient: { patientId: appointment.patient.id, fullName: appointment.patient.fullName },
    availabilityId: appointment.availability.id,
    consultationType: appointment.consultationType,
    scheduledAt: appointment.scheduledAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    status: appointment.status,
    patientNotes: appointment.patientNotes,
    cancellationReason: appointment.cancellationReason,
    confirmedAt: appointment.confirmedAt?.toISOString() ?? null,
    completedAt: appointment.completedAt?.toISOString() ?? null,
    cancelledAt: appointment.cancelledAt?.toISOString() ?? null,
    createdAt: appointment.createdAt.toISOString(),
    updatedAt: appointment.updatedAt.toISOString()
  };
}
