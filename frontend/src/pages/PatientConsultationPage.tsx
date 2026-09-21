import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Field, LoadingState, Panel } from "../components/ui";
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listDoctors(), listPatientAppointments()])
      .then(([doctorResponse, appointmentResponse]) => {
        setDoctors(doctorResponse);
        setAppointments(appointmentResponse);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, []);

  function leave(): void { signOut(); navigate("/"); }
  function refreshAppointments(): void { listPatientAppointments().then(setAppointments).catch((requestError: unknown) => setError(getErrorMessage(requestError))); }
  function book(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!slotId) { setError("Select an available date and time."); return; }
    setError(null);
    bookAppointment({ availabilityId: slotId, consultationType, patientNotes: notes.trim() || undefined })
      .then((appointment) => { setAppointments((current) => [appointment, ...current]); setSelected(appointment); setAvailability((current) => current.filter((slot) => slot.availabilityId !== slotId)); setSlotId(""); setNotes(""); setNotice("Consultation booked successfully."); })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)));
  }
  function openAppointment(id: string): void { getPatientAppointment(id).then(setSelected).catch((requestError: unknown) => setError(getErrorMessage(requestError))); }
  function cancel(): void {
    if (!selected) return;
    const reason = window.prompt("Cancellation reason (optional):") ?? "";
    cancelPatientAppointment(selected.appointmentId, reason || undefined)
      .then((appointment) => { setSelected(appointment); setNotice("Appointment cancelled."); refreshAppointments(); })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)));
  }

  if (!user) return null;
  return <main className="workspace-page consultation-page"><header className="workspace-header"><div><p className="eyebrow">Patient care</p><h1>Doctor consultations</h1><p className="intro">Book an in-clinic or phone consultation from available doctor slots.</p></div><Button className="button-secondary" type="button" onClick={leave}>Sign out</Button></header>{error ? <Alert>{error}</Alert> : null}{notice ? <div className="success-message" role="status">{notice}</div> : null}{loading ? <LoadingState label="Loading consultations..." /> : <section className="consultation-grid"><Panel><h2>Book a consultation</h2><form className="form-stack" onSubmit={book}><Field label="Doctor" htmlFor="consult-doctor"><select className="input" id="consult-doctor" value={doctorId} onChange={(event) => { const nextDoctorId = event.target.value; setDoctorId(nextDoctorId); setAvailability([]); setSlotId(""); if (!nextDoctorId) return; setSlotLoading(true); setError(null); listAvailability(nextDoctorId).then(setAvailability).catch((requestError: unknown) => setError(getErrorMessage(requestError))).finally(() => setSlotLoading(false)); }}><option value="">Select an approved doctor</option>{doctors.map((doctor) => <option key={doctor.doctorId} value={doctor.doctorId}>{doctor.fullName}</option>)}</select></Field><Field label="Available date and time" htmlFor="consult-slot"><select className="input" id="consult-slot" value={slotId} onChange={(event) => setSlotId(event.target.value)} disabled={!doctorId || slotLoading}><option value="">{slotLoading ? "Loading slots..." : availability.length ? "Select an available slot" : "No available slots"}</option>{availability.map((slot) => <option key={slot.availabilityId} value={slot.availabilityId}>{formatDate(slot.startsAt)} - {formatTime(slot.endsAt)}</option>)}</select></Field><fieldset className="consultation-choice"><legend>Consultation type</legend><label><input type="radio" name="consultation-type" checked={consultationType === "IN_CLINIC"} onChange={() => setConsultationType("IN_CLINIC")} /> In-clinic</label><label><input type="radio" name="consultation-type" checked={consultationType === "PHONE"} onChange={() => setConsultationType("PHONE")} /> Phone</label></fieldset><Field label="Patient notes (optional)" htmlFor="consult-notes"><textarea className="input textarea" id="consult-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></Field><Button type="submit" disabled={!slotId}>Book appointment</Button></form></Panel><Panel><h2>My appointments</h2>{appointments.length === 0 ? <p className="empty-state">No appointments booked yet.</p> : <div className="stack-list">{appointments.map((appointment) => <button className="list-row list-row-button" type="button" key={appointment.appointmentId} onClick={() => openAppointment(appointment.appointmentId)}><div><strong>{appointment.doctor.fullName}</strong><span className="muted">{formatDate(appointment.scheduledAt)} • {appointment.consultationType === "PHONE" ? "Phone" : "In-clinic"}</span></div><span className="status">{appointment.status}</span></button>)}</div>}</Panel>{selected ? <Panel><h2>Appointment details</h2><p><strong>{selected.doctor.fullName}</strong></p><p>{formatDate(selected.scheduledAt)} - {formatTime(selected.endsAt)}</p><p>Type: {selected.consultationType === "PHONE" ? "Phone" : "In-clinic"}</p><p>Status: <strong>{selected.status}</strong></p>{selected.patientNotes ? <p className="muted">Notes: {selected.patientNotes}</p> : null}{selected.cancellationReason ? <p className="muted">Cancellation reason: {selected.cancellationReason}</p> : null}{selected.status === "PENDING" || selected.status === "CONFIRMED" ? <Button className="button-secondary" type="button" onClick={cancel}>Cancel appointment</Button> : null}</Panel> : null}</section>}</main>;
}

function formatDate(value: string): string { return new Date(value).toLocaleDateString(); }
function formatTime(value: string): string { return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
function getErrorMessage(error: unknown): string { return error instanceof ApiError ? error.message : "The consultation request could not be completed."; }
