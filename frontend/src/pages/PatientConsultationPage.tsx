import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PatientPageShell } from "../shell/PatientPageShell";
import { Alert, BackLink, Button, EmptyState, Field, LoadingState, PageHero, Panel } from "../components/ui";
import { ShieldHeartIcon, StethoscopeIcon, SupportIcon } from "../components/icons";
import { StatusChip } from "../components/StatusChip";
import {
  bookAppointment,
  cancelPatientAppointment,
  getPatientAppointment,
  listAvailability,
  listDoctors,
  listPatientAppointments,
  type Appointment,
  type Availability,
  type Doctor
} from "../consultations/consultation-api";

type Navigate = (path: string) => void;

export function PatientConsultationPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [slotId, setSlotId] = useState("");
  const [consultationType, setConsultationType] = useState<"IN_CLINIC" | "PHONE">("IN_CLINIC");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [slotLoading, setSlotLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const slotsRequestToken = useRef(0);

  useEffect(() => {
    Promise.all([listDoctors(), listPatientAppointments()])
      .then(([doctorResponse, appointmentResponse]) => {
        setDoctors(doctorResponse);
        setAppointments(appointmentResponse);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, []);

  function loadSlots(nextDoctorId: string): void {
    setAvailability([]);
    setSlotId("");
    if (!nextDoctorId) return;
    const requestToken = ++slotsRequestToken.current;
    setSlotLoading(true);
    setError(null);
    listAvailability(nextDoctorId)
      .then((slots) => {
        if (slotsRequestToken.current !== requestToken) return; // a newer doctor selection superseded this response
        setAvailability(slots);
      })
      .catch((requestError: unknown) => {
        if (slotsRequestToken.current === requestToken) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (slotsRequestToken.current === requestToken) setSlotLoading(false);
      });
  }

  function leave(): void { signOut(); navigate("/"); }
  void leave;
  function refreshAppointments(): void { listPatientAppointments().then(setAppointments).catch((requestError: unknown) => setError(getErrorMessage(requestError))); }
  function book(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!slotId || booking) { if (!slotId) setError("Select an available date and time."); return; }
    setBooking(true);
    setError(null);
    bookAppointment({ availabilityId: slotId, consultationType, patientNotes: notes.trim() || undefined })
      .then((appointment) => { setAppointments((current) => [appointment, ...current]); setSelected(appointment); setAvailability((current) => current.filter((slot) => slot.availabilityId !== slotId)); setSlotId(""); setNotes(""); setNotice("Consultation booked successfully."); })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setBooking(false));
  }
  function openAppointment(id: string): void { getPatientAppointment(id).then(setSelected).catch((requestError: unknown) => setError(getErrorMessage(requestError))); }
  function cancel(): void {
    if (!selected || booking) return; // one appointment mutation at a time
    const reason = window.prompt("Cancellation reason (optional):") ?? "";
    setBooking(true);
    cancelPatientAppointment(selected.appointmentId, reason || undefined)
      .then((appointment) => { setSelected(appointment); setNotice("Appointment cancelled."); refreshAppointments(); })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setBooking(false));
  }

  if (!user) return null;
  return (
    <PatientPageShell
      navigate={navigate}
      activePath="/patient/consultations"
      className="consultations-page"
      backSlot={<BackLink navigate={navigate} fallback="/patient" label="Back to dashboard" />}
    >
      <PageHero
        tone="blue"
        eyebrow="Oncology Specialists &amp; Care"
        title="Doctor consultations,"
        highlight="at your pace."
        description="Book in-clinic appointments or phone consultations from your oncology doctor's published availability. All visit notes and history are securely kept in your workspace."
        image="/assets/hero/doctor-patient.webp"
        imageAlt="A doctor discussing care with a patient"
        badge={
          <>
            <ShieldHeartIcon size={16} /> Verified Oncology Doctors
          </>
        }
        crumbs={[
          { label: "Dashboard", href: "/patient" },
          { label: "Consultations" }
        ]}
      />

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}

      {loading ? (
        <LoadingState label="Loading consultations..." />
      ) : (
        <section className="consultation-grid">
          <Panel>
            <h2>Book a consultation</h2>
            <form className="form-stack" onSubmit={book}>
              <Field label="Choose oncologist / doctor" htmlFor="consult-doctor">
                <select
                  className="input"
                  id="consult-doctor"
                  value={doctorId}
                  onChange={(event) => {
                    const nextDoctorId = event.target.value;
                    setDoctorId(nextDoctorId);
                    loadSlots(nextDoctorId);
                  }}
                >
                  <option value="">Select an approved doctor</option>
                  {doctors.map((doctor) => (
                    <option key={doctor.doctorId} value={doctor.doctorId}>
                      {doctor.fullName}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Consultation mode" htmlFor="consultation-type">
                <div className="consultation-mode-toggle" role="radiogroup" aria-label="Consultation type">
                  <div
                    tabIndex={0}
                    role="radio"
                    aria-checked={consultationType === "IN_CLINIC"}
                    className={`mode-card${consultationType === "IN_CLINIC" ? " is-active" : ""}`}
                    onClick={() => setConsultationType("IN_CLINIC")}
                    onKeyDown={(e) => {
                      if (e.key === " " || e.key === "Enter") setConsultationType("IN_CLINIC");
                    }}
                  >
                    <StethoscopeIcon size={20} />
                    <div>
                      <strong>In-clinic Visit</strong>
                      <p className="field-hint" style={{ margin: 0 }}>Face-to-face checkup</p>
                    </div>
                  </div>
                  <div
                    tabIndex={0}
                    role="radio"
                    aria-checked={consultationType === "PHONE"}
                    className={`mode-card${consultationType === "PHONE" ? " is-active" : ""}`}
                    onClick={() => setConsultationType("PHONE")}
                    onKeyDown={(e) => {
                      if (e.key === " " || e.key === "Enter") setConsultationType("PHONE");
                    }}
                  >
                    <SupportIcon size={20} />
                    <div>
                      <strong>Phone Consultation</strong>
                      <p className="field-hint" style={{ margin: 0 }}>Voice call guidance</p>
                    </div>
                  </div>
                </div>
              </Field>

              <Field label="Available date and time slot" htmlFor="consult-slot">
                <select
                  className="input"
                  id="consult-slot"
                  value={slotId}
                  onChange={(event) => setSlotId(event.target.value)}
                  disabled={!doctorId || slotLoading}
                >
                  <option value="">
                    {slotLoading
                      ? "Loading available slots..."
                      : availability.length
                      ? "Select an available slot"
                      : doctorId
                      ? "No slots currently published for this doctor"
                      : "First select a doctor above"}
                  </option>
                  {availability.map((slot) => (
                    <option key={slot.availabilityId} value={slot.availabilityId}>
                      {formatDate(slot.startsAt)} at {formatTime(slot.startsAt)} – {formatTime(slot.endsAt)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Patient notes &amp; symptoms (optional)" htmlFor="consult-notes">
                <textarea
                  className="input textarea"
                  id="consult-notes"
                  value={notes}
                  placeholder="Share any specific symptoms, questions, or medical context for the doctor"
                  onChange={(event) => setNotes(event.target.value)}
                />
              </Field>

              <Button type="submit" disabled={!slotId || booking}>
                {booking ? "Confirming booking..." : "Book consultation appointment"}
              </Button>
            </form>
          </Panel>

          <Panel>
            <h2>My appointments</h2>
            {appointments.length === 0 ? (
              <EmptyState
                icon={<StethoscopeIcon size={22} />}
                title="No appointments booked yet"
                hint="Your upcoming oncology visits and phone consultations will appear here once booked."
              />
            ) : (
              <div className="stack-list">
                {appointments.map((appointment) => (
                  <button
                    className="list-row list-row-button"
                    type="button"
                    key={appointment.appointmentId}
                    onClick={() => openAppointment(appointment.appointmentId)}
                  >
                    <div>
                      <strong>{appointment.doctor.fullName}</strong>
                      <span className="muted">
                        {formatDate(appointment.scheduledAt)} • {appointment.consultationType === "PHONE" ? "Phone" : "In-clinic"}
                      </span>
                    </div>
                    <StatusChip status={appointment.status} />
                  </button>
                ))}
              </div>
            )}
          </Panel>

          {selected ? (
            <Panel>
              <h2>Appointment details</h2>
              <p><strong>{selected.doctor.fullName}</strong></p>
              <p>{formatDate(selected.scheduledAt)} - {formatTime(selected.endsAt)}</p>
              <p>Type: {selected.consultationType === "PHONE" ? "Phone consultation" : "In-clinic visit"}</p>
              <p>Status: <StatusChip status={selected.status} /></p>
              {selected.patientNotes ? <p className="muted">Notes: {selected.patientNotes}</p> : null}
              {selected.cancellationReason ? <p className="muted">Cancellation reason: {selected.cancellationReason}</p> : null}
              {selected.status === "PENDING" || selected.status === "CONFIRMED" ? (
                <Button className="button-secondary" type="button" disabled={booking} onClick={cancel}>
                  Cancel appointment
                </Button>
              ) : null}
            </Panel>
          ) : null}
        </section>
      )}
    </PatientPageShell>
  );
}

function formatDate(value: string): string { return new Date(value).toLocaleDateString(); }
function formatTime(value: string): string { return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
function getErrorMessage(error: unknown): string { return error instanceof ApiError ? error.message : "The consultation request could not be completed."; }
