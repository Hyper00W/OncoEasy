import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";
import {
  cancelDoctorAppointment,
  completeAppointment,
  confirmAppointment,
  createAvailability,
  deactivateAvailability,
  getDoctorAppointment,
  listDoctorAppointments,
  listOwnAvailability,
  type Appointment,
  type Availability
} from "../consultations/consultation-api";

type Navigate = (path: string) => void;

export function DoctorConsultationPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [slots, setSlots] = useState<Availability[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listOwnAvailability(), listDoctorAppointments()])
      .then(([slotResponse, appointmentResponse]) => { setSlots(slotResponse); setAppointments(appointmentResponse); })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, []);

  function leave(): void { signOut(); navigate("/"); }
  function refresh(): void { Promise.all([listOwnAvailability(), listDoctorAppointments()]).then(([slotResponse, appointmentResponse]) => { setSlots(slotResponse); setAppointments(appointmentResponse); }).catch((requestError: unknown) => setError(getErrorMessage(requestError))); }
  function addSlot(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!startsAt || !endsAt) { setError("Choose both a start and end time."); return; }
    setSubmitting(true);
    setError(null);
    createAvailability(new Date(startsAt).toISOString(), new Date(endsAt).toISOString())
      .then(() => { setNotice("Availability slot created."); setStartsAt(""); setEndsAt(""); refresh(); })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSubmitting(false));
  }
  function deactivate(id: string): void { deactivateAvailability(id).then(() => { setNotice("Availability slot deactivated."); refresh(); }).catch((requestError: unknown) => setError(getErrorMessage(requestError))); }
  function openAppointment(id: string): void { getDoctorAppointment(id).then(setSelected).catch((requestError: unknown) => setError(getErrorMessage(requestError))); }
  function action(kind: "confirm" | "complete" | "cancel"): void {
    if (!selected) return;
    const request = kind === "confirm" ? confirmAppointment(selected.appointmentId) : kind === "complete" ? completeAppointment(selected.appointmentId) : cancelDoctorAppointment(selected.appointmentId, window.prompt("Cancellation reason:") || "");
    request.then((appointment) => { setSelected(appointment); setNotice(`Appointment ${kind === "cancel" ? "cancelled" : kind === "complete" ? "completed" : "confirmed"}.`); refresh(); }).catch((requestError: unknown) => setError(getErrorMessage(requestError)));
  }

  if (!user) return null;
  return <main className="workspace-page consultation-page"><header className="workspace-header"><div><p className="eyebrow">Doctor workspace</p><h1>Consultations</h1><p className="intro">Manage date-specific slots and patient appointments.</p></div><Button className="button-secondary" type="button" onClick={leave}>Sign out</Button></header>{error ? <Alert>{error}</Alert> : null}{notice ? <div className="success-message" role="status">{notice}</div> : null}{loading ? <LoadingState label="Loading consultations..." /> : <section className="consultation-grid"><Panel><h2>Create availability</h2><form className="form-stack" onSubmit={addSlot}><Field label="Start" htmlFor="availability-start"><Input id="availability-start" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></Field><Field label="End" htmlFor="availability-end"><Input id="availability-end" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></Field><Button type="submit" disabled={submitting}>{submitting ? <LoadingState label="Creating..." /> : "Create slot"}</Button></form><h2 className="section-heading">Availability slots</h2>{slots.length === 0 ? <p className="empty-state">No availability slots created.</p> : <div className="stack-list">{slots.map((slot) => <div className="list-row" key={slot.availabilityId}><div><strong>{formatDate(slot.startsAt)}</strong><span className="muted">{formatTime(slot.startsAt)} - {formatTime(slot.endsAt)}{slot.booked ? " • Booked" : ""}</span></div>{slot.isActive && !slot.booked ? <Button className="button-link" type="button" onClick={() => deactivate(slot.availabilityId)}>Deactivate</Button> : <span className="status">{slot.booked ? "Booked" : "Inactive"}</span>}</div>)}</div>}</Panel><Panel><h2>Appointments</h2>{appointments.length === 0 ? <p className="empty-state">No appointments yet.</p> : <div className="stack-list">{appointments.map((appointment) => <button className="list-row list-row-button" type="button" key={appointment.appointmentId} onClick={() => openAppointment(appointment.appointmentId)}><div><strong>{appointment.patient.fullName}</strong><span className="muted">{formatDate(appointment.scheduledAt)} • {appointment.consultationType === "PHONE" ? "Phone" : "In-clinic"}</span></div><span className="status">{appointment.status}</span></button>)}</div>}</Panel>{selected ? <Panel><h2>Appointment details</h2><p><strong>{selected.patient.fullName}</strong></p><p>{formatDate(selected.scheduledAt)} - {formatTime(selected.endsAt)}</p><p>Type: {selected.consultationType === "PHONE" ? "Phone" : "In-clinic"}</p><p>Status: <strong>{selected.status}</strong></p>{selected.patientNotes ? <p className="muted">Patient notes: {selected.patientNotes}</p> : null}{selected.status === "PENDING" ? <div className="button-row"><Button type="button" onClick={() => action("confirm")}>Confirm</Button><Button className="button-secondary" type="button" onClick={() => action("cancel")}>Cancel</Button></div> : null}{selected.status === "CONFIRMED" ? <div className="button-row"><Button type="button" onClick={() => action("complete")}>Complete</Button><Button className="button-secondary" type="button" onClick={() => action("cancel")}>Cancel</Button></div> : null}{selected.cancellationReason ? <p className="muted">Cancellation reason: {selected.cancellationReason}</p> : null}</Panel> : null}</section>}</main>;
}

function formatDate(value: string): string { return new Date(value).toLocaleDateString(); }
function formatTime(value: string): string { return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
function getErrorMessage(error: unknown): string { return error instanceof ApiError ? error.message : "The consultation request could not be completed."; }
