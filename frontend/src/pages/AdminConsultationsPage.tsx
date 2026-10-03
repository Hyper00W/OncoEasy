import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  appointmentStatuses,
  getAdminAppointment,
  listAdminAppointments,
  type AdminAppointment,
  type AppointmentStatus
} from "../admin/admin-api";
import { AdminPortalShell } from "../admin/AdminPortalShell";
import { AdminDetailPanel } from "../components/admin/AdminDetailPanel";
import { AdminFilterBar, AdminSelectFilter } from "../components/admin/AdminFilterBar";
import { AdminPagination, AdminTable, type AdminColumn } from "../components/admin/AdminTable";
import { StatusChip } from "../components/StatusChip";
import { Button, Input } from "../components/ui";
import type { Navigate } from "../components/navigation-types";
import { formatDateTime, formatStatusLabel, formatTime } from "../components/status-utils";


const pageSize = 10;

/**
 * Consultation operations (Phase 6.5): read-only operational view over the
 * existing admin appointments API with server-side status/doctor/date
 * filtering exactly as the backend supports. No scheduling actions exist in
 * the admin API, so none are rendered.
 */
export function AdminConsultationsPage({ navigate }: { navigate: Navigate }) {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState<AdminAppointment[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize, total: 0, totalPages: 1 });
  const [selected, setSelected] = useState<AdminAppointment | null>(null);
  const [status, setStatus] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [query, setQuery] = useState<{ page: number; status: string; doctorId: string; from: string; to: string }>({
    page: 1, status: "", doctorId: "", from: "", to: ""
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestTokenRef = useRef(0);

  useEffect(() => {
    const requestToken = ++requestTokenRef.current;
    listAdminAppointments({
      page: query.page,
      pageSize,
      status: (query.status || undefined) as AppointmentStatus | undefined,
      doctorId: query.doctorId || undefined,
      from: query.from || undefined,
      to: query.to || undefined
    })
      .then((response) => {
        if (requestTokenRef.current !== requestToken) return;
        setAppointments(response.items);
        setPagination(response.pagination);
        setError(null);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (requestTokenRef.current !== requestToken) return;
        setError(describeError(requestError, "The consultations queue could not be loaded."));
        setLoading(false);
      });
  }, [query]);

  function openAppointment(appointmentId: string): void {
    setError(null);
    getAdminAppointment(appointmentId)
      .then((appointment) => {
        setSelected(appointment);
        setAppointments((current) => current.map((item) => (item.appointmentId === appointment.appointmentId ? appointment : item)));
      })
      .catch((requestError: unknown) => setError(describeError(requestError, "That appointment could not be opened.")));
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setQuery({ page: 1, status, doctorId: doctorId.trim(), from: toIso(fromInput, false), to: toIso(toInput, true) });
  }

  function clearFilters(): void {
    setStatus("");
    setDoctorId("");
    setFromInput("");
    setToInput("");
    setQuery({ page: 1, status: "", doctorId: "", from: "", to: "" });
  }

  const columns: AdminColumn<AdminAppointment>[] = [
    {
      header: "Patient",
      label: "Patient",
      cell: (appointment) => appointment.patient.fullName
    },
    {
      header: "Doctor",
      label: "Doctor",
      cell: (appointment) => appointment.doctor.fullName
    },
    {
      header: "Scheduled",
      label: "Scheduled",
      cell: (appointment) => (
        <div>
          {formatDateTime(appointment.scheduledAt)}
          <span className="table-subtext">until {formatTime(appointment.endsAt)}</span>
        </div>
      )
    },
    {
      header: "Mode",
      label: "Mode",
      cell: (appointment) => formatStatusLabel(appointment.consultationType)
    },
    {
      header: "Status",
      label: "Status",
      cell: (appointment) => <StatusChip status={appointment.status} />
    },
    {
      header: "Actions",
      hideHeader: true,
      label: "Actions",
      cell: (appointment) => (
        <Button className="button-link" type="button" onClick={() => openAppointment(appointment.appointmentId)}>
          Details
        </Button>
      )
    }
  ];

  if (!user) return null;

  return (
    <AdminPortalShell navigate={navigate} activePath="/admin/consultations" title="Consultations">
      <div className="admin-sections">
        <section className="panel admin-queue-panel" aria-label="Appointment queue">
          <div className="queue-head">
            <h2>Appointments</h2>
            <Button className="button-link" type="button" onClick={() => setQuery({ ...query })}>
              Refresh
            </Button>
          </div>
          <AdminFilterBar onApply={applyFilters} onClear={clearFilters}>
            <AdminSelectFilter
              id="admin-consultations-status"
              label="Appointment status"
              value={status}
              options={appointmentStatuses}
              allLabel="All statuses"
              onChange={setStatus}
            />
            <div className="admin-filter-field">
              <label className="visually-hidden" htmlFor="admin-consultations-doctor">Doctor user ID</label>
              <Input
                id="admin-consultations-doctor"
                value={doctorId}
                onChange={(event) => setDoctorId(event.target.value)}
                placeholder="Doctor user ID (UUID)"
              />
            </div>
            <div className="admin-filter-field">
              <label className="visually-hidden" htmlFor="admin-consultations-from">From date</label>
              <Input id="admin-consultations-from" type="date" value={fromInput} onChange={(event) => setFromInput(event.target.value)} />
            </div>
            <div className="admin-filter-field">
              <label className="visually-hidden" htmlFor="admin-consultations-to">To date</label>
              <Input id="admin-consultations-to" type="date" value={toInput} onChange={(event) => setToInput(event.target.value)} />
            </div>
          </AdminFilterBar>

          <AdminTable
            columns={columns}
            rows={appointments}
            getKey={(appointment) => appointment.appointmentId}
            loading={loading}
            loadingLabel="Loading appointments..."
            emptyTitle="No appointments match these filters"
            emptyHint="Consultations appear here as patients book doctor availability."
            error={error}
            onRetry={() => setQuery({ ...query })}
          />

          <AdminPagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            singular="appointment"
            plural="appointments"
            disabled={loading}
            onPrevious={() => setQuery({ ...query, page: pagination.page - 1 })}
            onNext={() => setQuery({ ...query, page: pagination.page + 1 })}
          />
        </section>

        {selected ? (
          <AdminDetailPanel
            eyebrow={formatStatusLabel(selected.status)}
            title={`${selected.patient.fullName} with ${selected.doctor.fullName}`}
            meta={`${formatStatusLabel(selected.consultationType)} • ${formatDateTime(selected.scheduledAt)}`}
            onClose={() => setSelected(null)}
            rows={[
              { label: "Status", value: <StatusChip status={selected.status} /> },
              { label: "Scheduled", value: `${formatDateTime(selected.scheduledAt)} – ${formatTime(selected.endsAt)}` },
              { label: "Patient notes", value: selected.patientNotes || "None" },
              selected.confirmedAt ? { label: "Confirmed", value: formatDateTime(selected.confirmedAt) } : null,
              selected.completedAt ? { label: "Completed", value: formatDateTime(selected.completedAt) } : null,
              selected.cancelledAt ? { label: "Cancelled", value: formatDateTime(selected.cancelledAt) } : null,
              selected.cancellationReason ? { label: "Cancellation reason", value: selected.cancellationReason } : null,
              { label: "Created", value: formatDateTime(selected.createdAt) }
            ].filter(Boolean) as { label: string; value: React.ReactNode }[]}
          />
        ) : null}
      </div>
    </AdminPortalShell>
  );
}

function toIso(value: string, endOfDay: boolean): string {
  if (!value) return "";
  const date = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
