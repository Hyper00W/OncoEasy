import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AdminPortalShell } from "../admin/AdminPortalShell";
import { AdminDetailPanel } from "../components/admin/AdminDetailPanel";
import { AdminTable } from "../components/admin/AdminTable";
import { StatusChip } from "../components/StatusChip";
import { Alert, Button, Field, Input, LoadingState } from "../components/ui";
import { formatDate, formatStatusLabel } from "../components/status-utils";
import type { Navigate } from "../components/navigation-types";
import {
  addAdminOpsNote,
  getAdminBooking,
  getAdminLabReport,
  getAdminDsaBooking,
  listAdminBookings,
  recordDsaBooking,
  type LabBooking,
  updateAdminBookingStatus,
  uploadAdminLabReport
} from "../labs/labs-api";

const statusOptions = [
  "PENDING_OPS",
  "BOOKED",
  "SAMPLE_COLLECTED",
  "REPORT_READY",
  "COMPLETED",
  "CANCELLED"
];

/**
 * Lab operations (Phase 6.5). Preserves the full existing manual workflow:
 * the Thyrocare DSA queue is an explicit manual-operations step (record the
 * DSA order ID by hand — there is no live provider integration), status
 * transitions and ops notes are manual, and reports flow through the
 * existing secure private-media endpoint. All actions map 1:1 to existing
 * OPS_ADMIN endpoints.
 */
export function AdminLabsPage({ navigate }: { navigate: Navigate }) {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<LabBooking[]>([]);
  const [selected, setSelected] = useState<LabBooking | null>(null);
  const [status, setStatus] = useState("BOOKED");
  const [reason, setReason] = useState("");
  const [externalOrderId, setExternalOrderId] = useState("");
  const [opsNote, setOpsNote] = useState("");
  const [dsaOnly, setDsaOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    loadQueue(false);
  }, []);

  function loadQueue(dsaQueue: boolean): void {
    setLoading(true);
    listAdminBookings({ dsaQueue })
      .then((response) => {
        setBookings(response);
        setError(null);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        setError(describeError(requestError, "The lab booking queue could not be loaded."));
        setLoading(false);
      });
  }

  function refresh(): void {
    listAdminBookings({ dsaQueue: dsaOnly })
      .then((response) => setBookings(response))
      .catch(() => undefined);
  }

  function toggleQueue(): void {
    const next = !dsaOnly;
    setDsaOnly(next);
    loadQueue(next);
  }

  function openBooking(bookingId: string): void {
    setError(null);
    getAdminDsaBooking(bookingId)
      .then(setSelected)
      .catch(() =>
        getAdminBooking(bookingId)
          .then(setSelected)
          .catch((requestError: unknown) => setError(describeError(requestError, "That booking could not be opened.")))
      );
  }

  function recordDsa(): void {
    if (!selected || !externalOrderId.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    recordDsaBooking(selected.bookingId, externalOrderId.trim())
      .then((booking) => {
        setSelected(booking);
        setNotice("Thyrocare DSA order ID recorded.");
        refresh();
      })
      .catch((requestError: unknown) => setError(describeError(requestError, "The DSA order ID could not be recorded.")))
      .finally(() => setSubmitting(false));
  }

  function saveOpsNote(): void {
    if (!selected || !opsNote.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    addAdminOpsNote(selected.bookingId, opsNote.trim())
      .then((booking) => {
        setSelected(booking);
        setNotice("Operational note added.");
        setOpsNote("");
        refresh();
      })
      .catch((requestError: unknown) => setError(describeError(requestError, "The note could not be saved.")))
      .finally(() => setSubmitting(false));
  }

  function saveStatus(): void {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError(null);
    updateAdminBookingStatus(selected.bookingId, { status, reason: reason.trim() || undefined })
      .then((booking) => {
        setSelected(booking);
        setNotice(`Booking status updated to ${formatStatusLabel(booking.status)}.`);
        setReason("");
        refresh();
      })
      .catch((requestError: unknown) => setError(describeError(requestError, "The status could not be updated.")))
      .finally(() => setSubmitting(false));
  }

  function uploadReport(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file || !selected || submitting) {
      event.target.value = "";
      return;
    }
    setError(null);
    uploadAdminLabReport(selected.bookingId, file)
      .then((booking) => {
        setSelected(booking);
        setNotice(`${file.name} uploaded successfully.`);
        refresh();
      })
      .catch((requestError: unknown) => setError(describeError(requestError, "The report could not be uploaded.")))
      .finally(() => {
        event.target.value = "";
      });
  }

  function openReport(): void {
    if (!selected?.report) return;
    getAdminLabReport(selected.bookingId)
      .then((report) => window.open(report.access.reference, "_blank", "noopener,noreferrer"))
      .catch((requestError: unknown) => setError(describeError(requestError, "The report could not be opened.")));
  }

  if (!user) return null;

  return (
    <AdminPortalShell navigate={navigate} activePath="/admin/labs" title="Labs & scans">
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}

      <div className="admin-sections">
        <section className="panel admin-queue-panel" aria-label="Lab booking queue">
          <div className="queue-head">
            <h2>Bookings</h2>
            <Button className="button-link" type="button" onClick={toggleQueue}>
              {dsaOnly ? "Show all bookings" : "Show pending Thyrocare DSA queue"}
            </Button>
          </div>

          <AdminTable
            columns={[
              { header: "Patient", label: "Patient", cell: (booking) => booking.patient.fullName },
              { header: "Test", label: "Test", cell: (booking) => booking.test.name },
              {
                header: "Collection",
                label: "Collection",
                cell: (booking) => `${formatStatusLabel(booking.collectionType)} • ${formatDate(booking.preferredDate)}`
              },
              {
                header: "DSA reference",
                label: "DSA reference",
                cell: (booking) => booking.externalOrderId ?? <span className="muted">Not recorded</span>
              },
              {
                header: "Report",
                label: "Report",
                cell: (booking) =>
                  booking.report ? <span className="status-chip status-chip-positive">Available</span> : <span className="muted">None</span>
              },
              { header: "Status", label: "Status", cell: (booking) => <StatusChip status={booking.status} /> },
              {
                header: "Actions",
                hideHeader: true,
                label: "Actions",
                cell: (booking) => (
                  <Button className="button-link" type="button" onClick={() => openBooking(booking.bookingId)}>
                    Details
                  </Button>
                )
              }
            ]}
            rows={bookings}
            getKey={(booking) => booking.bookingId}
            loading={loading}
            loadingLabel="Loading lab bookings..."
            emptyTitle={dsaOnly ? "No bookings are waiting for a DSA order ID" : "No lab bookings yet"}
            emptyHint={dsaOnly ? "All pending bookings have their Thyrocare DSA references recorded." : "Bookings appear here as patients request lab tests."}
            error={error}
            onRetry={() => loadQueue(dsaOnly)}
          />
        </section>

        {selected ? (
          <AdminDetailPanel
            eyebrow={formatStatusLabel(selected.status)}
            title={selected.test.name}
            meta={`Patient: ${selected.patient.fullName}`}
            onClose={() => setSelected(null)}
            rows={[
              { label: "Status", value: <StatusChip status={selected.status} /> },
              {
                label: "Collection",
                value: `${formatStatusLabel(selected.collectionType)} • preferred ${formatDate(selected.preferredDate)}${selected.preferredTimeSlot ? ` (${selected.preferredTimeSlot})` : ""}`
              },
              {
                label: "Provider",
                value: selected.provider ? `${selected.provider.provider} (${formatStatusLabel(selected.provider.mode)})` : "Not assigned"
              },
              { label: "Thyrocare DSA order ID", value: selected.externalOrderId ?? "Not recorded" },
              {
                label: "Report",
                value: selected.report
                  ? `${selected.report.documentName}${selected.report.uploadedAt ? ` • uploaded ${formatDate(selected.report.uploadedAt)}` : ""}`
                  : "Not uploaded"
              },
              { label: "Patient notes", value: selected.patientNotes || "None" }
            ]}
          >
            <p className="field-hint">
              Thyrocare DSA references and status updates are manual operational steps — they
              are recorded by operations staff, not by a live provider integration.
            </p>

            <div className="form-stack">
              <Field label="Record Thyrocare DSA order ID / reference" htmlFor="lab-external-order-id">
                <Input
                  id="lab-external-order-id"
                  value={externalOrderId}
                  onChange={(event) => setExternalOrderId(event.target.value)}
                  placeholder="THYROCARE-123"
                />
              </Field>
              <Button type="button" onClick={recordDsa} disabled={submitting || selected.status !== "PENDING_OPS"}>
                Record Thyrocare DSA order ID
              </Button>

              <Field label="Status" htmlFor="lab-status">
                <select className="input" id="lab-status" value={status} onChange={(event) => setStatus(event.target.value)}>
                  {statusOptions.map((option) => (
                    <option key={option} value={option}>{formatStatusLabel(option)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Status reason" htmlFor="lab-status-reason">
                <Input id="lab-status-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Optional reason" />
              </Field>
              <Button type="button" onClick={saveStatus} disabled={submitting}>
                {submitting ? "Updating..." : "Update status"}
              </Button>

              <Field label="Operational note (Ops-only)" htmlFor="lab-ops-note">
                <Input
                  id="lab-ops-note"
                  value={opsNote}
                  onChange={(event) => setOpsNote(event.target.value)}
                  placeholder="Internal DSA note (never shown to patients)"
                />
              </Field>
              <Button type="button" className="button-secondary" onClick={saveOpsNote} disabled={submitting || !opsNote.trim()}>
                Add note
              </Button>

              <Field label="Upload PDF report" htmlFor="lab-report-upload">
                <Input id="lab-report-upload" type="file" accept=".pdf" onChange={uploadReport} />
              </Field>

              {selected.report ? (
                <Button type="button" className="button-secondary" onClick={openReport}>
                  Open report securely
                </Button>
              ) : null}
            </div>

            {submitting ? <LoadingState label="Saving..." /> : null}
          </AdminDetailPanel>
        ) : null}
      </div>
    </AdminPortalShell>
  );
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
