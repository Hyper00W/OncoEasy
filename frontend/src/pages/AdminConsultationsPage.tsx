import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  appointmentStatuses,
  getAdminAppointment,
  listAdminAppointments,
  type AdminAppointment,
  type AppointmentStatus
} from "../admin/admin-api";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";

type Navigate = (path: string) => void;

const pageSize = 10;

export function AdminConsultationsPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [appointments, setAppointments] = useState<AdminAppointment[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize, total: 0, totalPages: 1 });
  const [selected, setSelected] = useState<AdminAppointment | null>(null);
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | "">("");
  const [doctorIdFilter, setDoctorIdFilter] = useState("");
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [query, setQuery] = useState<{ page: number; status: AppointmentStatus | ""; doctorId: string; from: string; to: string }>({ page: 1, status: "", doctorId: "", from: "", to: "" });
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAdminAppointments({
      page: query.page,
      pageSize,
      status: query.status || undefined,
      doctorId: query.doctorId || undefined,
      from: query.from || undefined,
      to: query.to || undefined
    })
      .then((response) => {
        setAppointments(response.items);
        setPagination(response.pagination);
        setError(null);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, [query]);

  function leave(): void {
    signOut();
    navigate("/");
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    setLoading(true);
    setQuery({ page: 1, status: statusFilter, doctorId: doctorIdFilter.trim(), from: toIso(fromInput, false), to: toIso(toInput, true) });
  }

  function clearFilters(): void {
    setStatusFilter("");
    setDoctorIdFilter("");
    setFromInput("");
    setToInput("");
    setError(null);
    setLoading(true);
    setQuery({ page: 1, status: "", doctorId: "", from: "", to: "" });
  }

  function openAppointment(appointmentId: string): void {
    setOpening(true);
    setError(null);
    getAdminAppointment(appointmentId)
      .then((appointment) => {
        setSelected(appointment);
        setAppointments((current) => current.map((item) => (item.appointmentId === appointment.appointmentId ? appointment : item)));
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setOpening(false));
  }

  if (!user) return null;

  return (
    <main className="workspace-page consultation-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Operations admin</p>
          <h1>Consultation operations</h1>
          <p className="intro">Review booked consultations across doctors, statuses, and dates.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={leave}>Sign out</Button>
      </header>

      {error ? <Alert>{error}</Alert> : null}

      <section className="consultation-grid">
        <Panel>
          <h2>Appointments</h2>
          <form className="form-stack" onSubmit={applyFilters}>
            <Field label="Status" htmlFor="consultations-admin-status">
              <select className="input" id="consultations-admin-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AppointmentStatus | "")}>
                <option value="">All statuses</option>
                {appointmentStatuses.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}
              </select>
            </Field>
            <Field label="Doctor ID" htmlFor="consultations-admin-doctor" hint="Optional. Filter by a specific doctor's user ID.">
              <Input id="consultations-admin-doctor" value={doctorIdFilter} onChange={(event) => setDoctorIdFilter(event.target.value)} placeholder="Doctor user ID (UUID)" />
            </Field>
            <Field label="From date" htmlFor="consultations-admin-from" hint="Scheduled on or after this local date.">
              <Input id="consultations-admin-from" type="date" value={fromInput} onChange={(event) => setFromInput(event.target.value)} />
            </Field>
            <Field label="To date" htmlFor="consultations-admin-to" hint="Scheduled on or before this local date.">
              <Input id="consultations-admin-to" type="date" value={toInput} onChange={(event) => setToInput(event.target.value)} />
            </Field>
            <div className="button-row">
              <Button type="submit">Apply filters</Button>
              <Button className="button-secondary" type="button" onClick={clearFilters}>Clear</Button>
            </div>
          </form>

          {loading ? (
            <LoadingState label="Loading appointments..." />
          ) : appointments.length === 0 ? (
            <p className="empty-state">No appointments match the current filters.</p>
          ) : (
            <div className="stack-list">
              {appointments.map((appointment) => (
                <button className="list-row list-row-button" type="button" key={appointment.appointmentId} onClick={() => openAppointment(appointment.appointmentId)}>
                  <div>
                    <strong>{appointment.patient.fullName} with {appointment.doctor.fullName}</strong>
                    <span className="muted">{formatDate(appointment.scheduledAt)} • {formatLabel(appointment.consultationType)}</span>
                  </div>
                  <span className="status">{formatLabel(appointment.status)}</span>
                </button>
              ))}
            </div>
          )}

          <div className="button-row">
            <Button className="button-secondary" type="button" disabled={loading || pagination.page <= 1} onClick={() => setQuery({ ...query, page: pagination.page - 1 })}>Previous</Button>
            <span className="field-hint">Page {pagination.page} of {Math.max(pagination.totalPages, 1)} • {pagination.total} appointment(s)</span>
            <Button className="button-secondary" type="button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => setQuery({ ...query, page: pagination.page + 1 })}>Next</Button>
          </div>
        </Panel>

        {opening ? <LoadingState label="Loading appointment..." /> : null}

        {selected ? (
          <Panel>
            <div className="detail-header">
              <div>
                <p className="eyebrow">{formatLabel(selected.status)}</p>
                <h2>{selected.patient.fullName} with {selected.doctor.fullName}</h2>
              </div>
              <Button className="button-secondary" type="button" onClick={() => setSelected(null)}>Close</Button>
            </div>
            <div className="stack-list">
              <p className="list-row"><strong>Scheduled</strong><span>{formatDate(selected.scheduledAt)} – {formatDate(selected.endsAt)}</span></p>
              <p className="list-row"><strong>Type</strong><span>{formatLabel(selected.consultationType)}</span></p>
              <p className="list-row"><strong>Doctor</strong><span>{selected.doctor.fullName}</span></p>
              <p className="list-row"><strong>Patient</strong><span>{selected.patient.fullName}</span></p>
              <p className="list-row"><strong>Patient notes</strong><span>{selected.patientNotes || "None"}</span></p>
              {selected.cancellationReason ? <p className="list-row"><strong>Cancellation reason</strong><span>{selected.cancellationReason}</span></p> : null}
              {selected.confirmedAt ? <p className="list-row"><strong>Confirmed</strong><span>{formatDate(selected.confirmedAt)}</span></p> : null}
              {selected.completedAt ? <p className="list-row"><strong>Completed</strong><span>{formatDate(selected.completedAt)}</span></p> : null}
              {selected.cancelledAt ? <p className="list-row"><strong>Cancelled</strong><span>{formatDate(selected.cancelledAt)}</span></p> : null}
              <p className="list-row"><strong>Created</strong><span>{formatDate(selected.createdAt)}</span></p>
            </div>
          </Panel>
        ) : null}
      </section>
    </main>
  );
}

function toIso(value: string, endOfDay: boolean): string {
  if (!value) return "";
  const date = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function formatLabel(value: string): string {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The consultations request could not be completed.";
}
