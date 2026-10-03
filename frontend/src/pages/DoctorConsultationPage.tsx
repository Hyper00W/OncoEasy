import { useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatusChip } from "../components/StatusChip";
import { Alert, Button, ErrorState, Field, Input, LoadingState, Panel } from "../components/ui";
import type { Navigate } from "../components/navigation-types";
import { formatDate, formatDateTime, formatStatusLabel, formatTime } from "../components/status-utils";
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
import { DoctorPortalShell } from "../doctor/DoctorPortalShell";

type PendingAction =
  | { kind: "confirm"; appointment: Appointment }
  | { kind: "complete"; appointment: Appointment }
  | { kind: "cancel"; appointment: Appointment };

/**
 * Doctor consultations (Phase 6.4): date-scoped availability management, a
 * week calendar built from real appointments, and a guarded action flow
 * (confirm / complete / cancel with confirmation dialog). Only transitions
 * the backend supports are ever enabled: PENDING→confirm/cancel,
 * CONFIRMED→complete/cancel.
 */
export function DoctorConsultationPage({ navigate }: { navigate: Navigate }) {
  const [slots, setSlots] = useState<Availability[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [calendarAnchor, setCalendarAnchor] = useState(() => startOfWeek(new Date()));
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [working, setWorking] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingDeactivation, setPendingDeactivation] = useState<Availability | null>(null);
  const refreshRequestToken = useRef(0);

  function loadWorkspace(): void {
    const requestToken = ++refreshRequestToken.current;
    Promise.all([listOwnAvailability(), listDoctorAppointments()])
      .then(([slotResponse, appointmentResponse]) => {
        if (refreshRequestToken.current !== requestToken) return;
        setSlots(slotResponse);
        setAppointments(appointmentResponse);
        setLoadError(null);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (refreshRequestToken.current !== requestToken) return;
        setLoadError(
          requestError instanceof Error && requestError.name === "ApiError"
            ? requestError.message
            : "The consultation workspace could not be loaded."
        );
        setLoading(false);
      });
  }

  useEffect(() => {
    loadWorkspace();
  }, []);

  function refresh(): void {
    loadWorkspace();
  }

  function addSlot(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submitting) return;
    if (!startsAt || !endsAt) {
      setFormError("Choose both a start and end time.");
      return;
    }
    if (new Date(endsAt) <= new Date(startsAt)) {
      setFormError("The slot must end after it starts.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    setError(null);
    createAvailability(new Date(startsAt).toISOString(), new Date(endsAt).toISOString())
      .then(() => {
        setNotice("Availability slot created. Patients can now book it.");
        setStartsAt("");
        setEndsAt("");
        refresh();
      })
      .catch((requestError: unknown) =>
        setFormError(
          requestError instanceof Error && requestError.name === "ApiError"
            ? requestError.message
            : "The slot could not be created."
        )
      )
      .finally(() => setSubmitting(false));
  }

  function deactivateSlot(): void {
    if (!pendingDeactivation || submitting) return;
    setSubmitting(true);
    deactivateAvailability(pendingDeactivation.availabilityId)
      .then(() => {
        setNotice("Availability slot deactivated.");
        setPendingDeactivation(null);
        refresh();
      })
      .catch((requestError: unknown) =>
        setError(
          requestError instanceof Error && requestError.name === "ApiError"
            ? requestError.message
            : "The slot could not be deactivated."
        )
      )
      .finally(() => setSubmitting(false));
  }

  function openAppointment(id: string): void {
    setError(null);
    getDoctorAppointment(id)
      .then(setSelected)
      .catch(() => setError("That appointment could not be opened. Refresh and try again."));
  }

  function runPendingAction(): void {
    if (!pendingAction || working) return;
    const { kind, appointment } = pendingAction;
    setWorking(true);
    setError(null);
    const request =
      kind === "confirm"
        ? confirmAppointment(appointment.appointmentId)
        : kind === "complete"
          ? completeAppointment(appointment.appointmentId)
          : cancelDoctorAppointment(appointment.appointmentId, cancelReason.trim());
    request
      .then((updated) => {
        setSelected(updated);
        setNotice(
          kind === "confirm"
            ? "Appointment confirmed. The patient is informed through their workspace."
            : kind === "complete"
              ? "Appointment marked complete."
              : "Appointment cancelled."
        );
        setPendingAction(null);
        setCancelReason("");
        refresh();
      })
      .catch((requestError: unknown) =>
        setError(
          requestError instanceof Error && requestError.name === "ApiError"
            ? requestError.message
            : "The appointment action could not be completed."
        )
      )
      .finally(() => setWorking(false));
  }

  const weekDays = buildWeek(calendarAnchor);

  return (
    <DoctorPortalShell navigate={navigate} activePath="/doctor/consultations">
      <header className="portal-hero">
        <p className="portal-hero-eyebrow">Doctor workspace</p>
        <h1>Consultations</h1>
        <p className="portal-hero-copy">
          Publish bookable slots, confirm requests, and complete consultations. Phone
          consultations are coordinated directly with the patient.
        </p>
      </header>

      {loading ? (
        <div className="portal-sections" aria-hidden="true">
          <div className="skeleton skeleton-hero" />
          <div className="skeleton skeleton-card" />
        </div>
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={refresh} />
      ) : (
        <div className="portal-sections">
          {notice ? <div className="success-message" role="status">{notice}</div> : null}
          {error ? <Alert>{error}</Alert> : null}

          <div className="consultation-grid">
            <Panel>
              <h2>Create availability</h2>
              <form className="form-stack" onSubmit={addSlot}>
                <div className="field-pair">
                  <Field label="Start" htmlFor="availability-start">
                    <input
                      className="input"
                      id="availability-start"
                      type="datetime-local"
                      value={startsAt}
                      onChange={(event) => setStartsAt(event.target.value)}
                    />
                  </Field>
                  <Field label="End" htmlFor="availability-end">
                    <input
                      className="input"
                      id="availability-end"
                      type="datetime-local"
                      value={endsAt}
                      onChange={(event) => setEndsAt(event.target.value)}
                    />
                  </Field>
                </div>
                {formError ? <Alert>{formError}</Alert> : null}
                <Button type="submit" disabled={submitting}>
                  {submitting ? <LoadingState label="Creating..." /> : "Create slot"}
                </Button>
              </form>

              <h2 className="section-heading">Availability slots</h2>
              {slots.length === 0 ? (
                <div className="empty-state-block" role="status">
                  <p className="empty-state-title">No availability yet</p>
                  <p className="empty-state-hint">
                    Create your first slot above so patients can book a consultation with you.
                  </p>
                </div>
              ) : (
                <div className="stack-list">
                  {slots
                    .slice()
                    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())
                    .slice(0, 8)
                    .map((slot) => (
                      <div className="list-row" key={slot.availabilityId}>
                        <div>
                          <strong>{formatDate(slot.startsAt)}</strong>
                          <span className="muted">
                            {formatTime(slot.startsAt)} – {formatTime(slot.endsAt)}
                            {slot.booked ? " • Booked" : slot.isActive ? "" : " • Inactive"}
                          </span>
                        </div>
                        {slot.isActive && !slot.booked ? (
                          <Button
                            className="button-link"
                            type="button"
                            disabled={submitting}
                            onClick={() => setPendingDeactivation(slot)}
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <StatusChip status={slot.booked ? "CONFIRMED" : "INACTIVE"} />
                        )}
                      </div>
                    ))}
                </div>
              )}
            </Panel>

            <Panel>
              <div className="calendar-toolbar">
                <h2 className="calendar-title">Schedule</h2>
                <div className="button-row">
                  <Button
                    className="button-secondary"
                    type="button"
                    aria-label="Previous week"
                    onClick={() => setCalendarAnchor(addWeeks(calendarAnchor, -1))}
                  >
                    ←
                  </Button>
                  <Button
                    className="button-secondary"
                    type="button"
                    onClick={() => setCalendarAnchor(startOfWeek(new Date()))}
                  >
                    This week
                  </Button>
                  <Button
                    className="button-secondary"
                    type="button"
                    aria-label="Next week"
                    onClick={() => setCalendarAnchor(addWeeks(calendarAnchor, 1))}
                  >
                    →
                  </Button>
                </div>
              </div>
              <WeekCalendar
                weekDays={weekDays}
                appointments={appointments}
                onOpen={openAppointment}
              />
            </Panel>
          </div>

          <Panel>
            <h2>All appointments</h2>
            {appointments.length === 0 ? (
              <div className="empty-state-block" role="status">
                <p className="empty-state-title">No appointments yet</p>
                <p className="empty-state-hint">
                  When patients book your slots, requests appear here for confirmation.
                </p>
              </div>
            ) : (
              <div className="appointment-table-wrap">
                <table className="appointment-table">
                  <thead>
                    <tr>
                      <th scope="col">Patient</th>
                      <th scope="col">When</th>
                      <th scope="col">Type</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointments.map((appointment) => (
                      <tr key={appointment.appointmentId}>
                        <td data-label="Patient">{appointment.patient.fullName}</td>
                        <td data-label="When">{formatDateTime(appointment.scheduledAt)}</td>
                        <td data-label="Type">
                          {appointment.consultationType === "PHONE" ? "Phone" : "In-clinic"}
                        </td>
                        <td data-label="Status">
                          <StatusChip status={appointment.status} />
                        </td>
                        <td data-label="Actions">
                          <Button className="button-link" type="button" onClick={() => openAppointment(appointment.appointmentId)}>
                            Details
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {selected ? (
            <Panel>
              <div className="detail-header">
                <div>
                  <p className="eyebrow">Appointment {selected.appointmentId.slice(0, 8)}</p>
                  <h2>{selected.patient.fullName}</h2>
                </div>
                <StatusChip status={selected.status} />
              </div>
              <dl className="detail-list">
                <div>
                  <dt>Scheduled</dt>
                  <dd>{formatDateTime(selected.scheduledAt)} – {formatTime(selected.endsAt)}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{selected.consultationType === "PHONE" ? "Phone consultation" : "In-clinic visit"}</dd>
                </div>
                {selected.confirmedAt ? (
                  <div>
                    <dt>Confirmed</dt>
                    <dd>{formatDateTime(selected.confirmedAt)}</dd>
                  </div>
                ) : null}
                {selected.completedAt ? (
                  <div>
                    <dt>Completed</dt>
                    <dd>{formatDateTime(selected.completedAt)}</dd>
                  </div>
                ) : null}
                {selected.patientNotes ? (
                  <div>
                    <dt>Patient notes</dt>
                    <dd>{selected.patientNotes}</dd>
                  </div>
                ) : null}
                {selected.cancellationReason ? (
                  <div>
                    <dt>Cancellation reason</dt>
                    <dd>{selected.cancellationReason}</dd>
                  </div>
                ) : null}
              </dl>
              {selected.status === "PENDING" || selected.status === "CONFIRMED" ? (
                <div className="button-row">
                  {selected.status === "PENDING" ? (
                    <Button type="button" disabled={working} onClick={() => setPendingAction({ kind: "confirm", appointment: selected })}>
                      Confirm appointment
                    </Button>
                  ) : (
                    <Button type="button" disabled={working} onClick={() => setPendingAction({ kind: "complete", appointment: selected })}>
                      Mark complete
                    </Button>
                  )}
                  <Button
                    className="button-secondary"
                    type="button"
                    disabled={working}
                    onClick={() => {
                      setCancelReason("");
                      setPendingAction({ kind: "cancel", appointment: selected });
                    }}
                  >
                    Cancel appointment
                  </Button>
                </div>
              ) : (
                <p className="muted">
                  This appointment is {formatStatusLabel(selected.status).toLowerCase()}; no further
                  actions are available.
                </p>
              )}
            </Panel>
          ) : null}
        </div>
      )}

      {pendingAction?.kind === "cancel" ? (
        <div className="modal-reason-slot">
          <Field label="Cancellation reason (required)" htmlFor="cancel-reason">
            <Input
              id="cancel-reason"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="e.g. Unexpected schedule change"
            />
          </Field>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingAction !== null}
        busy={working}
        title={
          pendingAction?.kind === "confirm"
            ? "Confirm this appointment?"
            : pendingAction?.kind === "complete"
              ? "Mark this consultation complete?"
              : "Cancel this appointment?"
        }
        description={
          pendingAction?.kind === "confirm"
            ? `${pendingAction.appointment.patient.fullName} — ${formatDateTime(pendingAction.appointment.scheduledAt)}. The patient will see it as confirmed.`
            : pendingAction?.kind === "complete"
              ? `${pendingAction.appointment.patient.fullName} — ${formatDateTime(pendingAction.appointment.scheduledAt)}. Completed appointments cannot be reopened.`
              : pendingAction
                ? `Add a cancellation reason for ${pendingAction.appointment.patient.fullName}. The patient sees the cancellation in their workspace.`
                : ""
        }
        confirmLabel={
          pendingAction?.kind === "confirm" ? "Confirm" : pendingAction?.kind === "complete" ? "Complete" : "Cancel appointment"
        }
        tone={pendingAction?.kind === "cancel" ? "danger" : "primary"}
        onConfirm={runPendingAction}
        onCancel={() => {
          if (working) return;
          setPendingAction(null);
          setCancelReason("");
        }}
      />

      <ConfirmDialog
        open={pendingDeactivation !== null}
        busy={submitting}
        title="Deactivate this slot?"
        description={
          pendingDeactivation
            ? `${formatDate(pendingDeactivation.startsAt)} ${formatTime(pendingDeactivation.startsAt)} – ${formatTime(pendingDeactivation.endsAt)} will no longer be bookable.`
            : ""
        }
        confirmLabel="Deactivate slot"
        onConfirm={deactivateSlot}
        onCancel={() => setPendingDeactivation(null)}
      />
    </DoctorPortalShell>
  );
}

function WeekCalendar({
  weekDays,
  appointments,
  onOpen
}: {
  weekDays: Date[];
  appointments: Appointment[];
  onOpen: (appointmentId: string) => void;
}) {
  const activeStatuses = ["PENDING", "CONFIRMED"];
  const byDay = new Map<string, Appointment[]>();
  for (const appointment of appointments) {
    if (!activeStatuses.includes(appointment.status)) continue;
    const key = toDateKey(appointment.scheduledAt);
    byDay.set(key, [...(byDay.get(key) ?? []), appointment]);
  }

  return (
    <div className="week-calendar" role="grid" aria-label="Weekly schedule">
      {weekDays.map((day) => {
        const key = toDateKey(day.toISOString());
        const dayAppointments = (byDay.get(key) ?? []).sort(
          (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
        );
        const isToday = toDateKey(new Date().toISOString()) === key;
        return (
          <div className={`calendar-day${isToday ? " is-today" : ""}`} key={key}>
            <p className="calendar-day-name">
              {day.toLocaleDateString(undefined, { weekday: "short" })}
            </p>
            <p className="calendar-day-date">{day.getDate()}</p>
            {dayAppointments.length === 0 ? (
              <p className="calendar-day-empty">—</p>
            ) : (
              dayAppointments.map((appointment) => (
                <button
                  className={`calendar-chip${appointment.status === "PENDING" ? " calendar-chip-pending" : ""}`}
                  type="button"
                  key={appointment.appointmentId}
                  onClick={() => onOpen(appointment.appointmentId)}
                  title={`${appointment.patient.fullName} • ${formatTime(appointment.scheduledAt)}`}
                >
                  {formatTime(appointment.scheduledAt)}{" "}
                  {appointment.patient.fullName.split(" ")[0]}
                </button>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();
  result.setDate(result.getDate() - ((day + 6) % 7)); // Monday start
  result.setHours(0, 0, 0, 0);
  return result;
}

function addWeeks(date: Date, weeks: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + weeks * 7);
  return result;
}

function buildWeek(anchor: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(anchor);
    day.setDate(anchor.getDate() + index);
    return day;
  });
}

function toDateKey(value: string): string {
  return new Date(value).toDateString();
}
