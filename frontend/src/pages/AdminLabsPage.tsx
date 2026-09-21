import { useEffect, useMemo, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";
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

type Navigate = (path: string) => void;

const statusOptions = [
  "PENDING_OPS",
  "BOOKED",
  "SAMPLE_COLLECTED",
  "REPORT_READY",
  "COMPLETED",
  "CANCELLED"
];

export function AdminLabsPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [bookings, setBookings] = useState<LabBooking[]>([]);
  const [selected, setSelected] = useState<LabBooking | null>(null);
  const [status, setStatus] = useState("BOOKED");
  const [reason, setReason] = useState("");
  const [externalOrderId, setExternalOrderId] = useState("");
  const [opsNote, setOpsNote] = useState("");
  const [dsaOnly, setDsaOnly] = useState(false);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    listAdminBookings({ dsaQueue: dsaOnly })
      .then((response) => {
        setBookings(response);
        if (response[0]) {
          setSelected(response[0]);
        }
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only; queue toggle uses toggleDsaQueue
  }, []);

  function leave(): void {
    signOut();
    navigate("/");
  }

  function refresh(): void {
    listAdminBookings({ dsaQueue: dsaOnly })
      .then((response) => {
        setBookings(response);
        if (selected) {
          const nextSelection = response.find((item) => item.bookingId === selected.bookingId) ?? response[0] ?? null;
          setSelected(nextSelection);
        }
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)));
  }

  function openBooking(bookingId: string): void {
    getAdminDsaBooking(bookingId)
      .then(setSelected)
      .catch(() => getAdminBooking(bookingId).then(setSelected).catch((requestError: unknown) => setError(getErrorMessage(requestError))));
  }

  function recordDsa(): void {
    if (!selected || !externalOrderId.trim()) {
      setError("Add a valid Thyrocare DSA order ID.");
      return;
    }

    setSubmitting(true);
    setError(null);
    recordDsaBooking(selected.bookingId, externalOrderId.trim())
      .then((booking) => {
        setSelected(booking);
        setNotice("Thyrocare DSA order ID recorded.");
        refresh();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSubmitting(false));
  }

  function saveOpsNote(): void {
    if (!selected || !opsNote.trim()) {
      return;
    }

    setSubmitting(true);
    setError(null);
    addAdminOpsNote(selected.bookingId, opsNote.trim())
      .then((booking) => {
        setSelected(booking);
        setNotice("Operational note added.");
        setOpsNote("");
        refresh();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSubmitting(false));
  }

  const dsaQueueLabel = useMemo(
    () => (dsaOnly ? "Show all bookings" : "Show pending Thyrocare DSA queue"),
    [dsaOnly]
  );

  function toggleDsaQueue(): void {
    const next = !dsaOnly;
    setDsaOnly(next);
    setError(null);
    listAdminBookings({ dsaQueue: next })
      .then((response) => {
        setBookings(response);
        setSelected(response[0] ?? null);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)));
  }

  function saveStatus(): void {
    if (!selected) {
      return;
    }

    setSubmitting(true);
    setError(null);
    updateAdminBookingStatus(selected.bookingId, {
      status,
      reason: reason.trim() || undefined
    })
      .then((booking) => {
        setSelected(booking);
        setNotice(`Booking status updated to ${booking.status}.`);
        refresh();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSubmitting(false));
  }

  function uploadReport(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file || !selected) {
      return;
    }

    setError(null);
    uploadAdminLabReport(selected.bookingId, file)
      .then((booking) => {
        setSelected(booking);
        setNotice(`${file.name} uploaded successfully.`);
        setReportFile(null);
        refresh();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => {
        event.target.value = "";
      });
  }

  if (!user) return null;

  return (
    <main className="workspace-page consultation-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Operations admin</p>
          <h1>Lab bookings</h1>
          <p className="intro">Manage assigned collections, Thyrocare DSA references, and report uploads.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={leave}>Sign out</Button>
      </header>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}

      {loading ? (
        <LoadingState label="Loading lab bookings..." />
      ) : (
        <section className="consultation-grid">
          <Panel>
            <h2>Queue</h2>
            <p className="muted">
              <button className="link-button" type="button" onClick={toggleDsaQueue}>
                {dsaQueueLabel}
              </button>
            </p>
            {bookings.length === 0 ? (
              <p className="empty-state">No lab bookings found.</p>
            ) : (
              <div className="stack-list">
                {bookings.map((booking) => (
                  <button className="list-row list-row-button" type="button" key={booking.bookingId} onClick={() => openBooking(booking.bookingId)}>
                    <div>
                      <strong>{booking.patient.fullName}</strong>
                      <span className="muted">{booking.test.name} • {formatDate(booking.preferredDate)}</span>
                    </div>
                    <span className="status">{booking.status}</span>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          {selected ? (
            <Panel>
              <h2>Booking detail</h2>
              <p><strong>{selected.test.name}</strong></p>
              <p className="muted">Patient: {selected.patient.fullName}</p>
              <p className="muted">Collection: {selected.collectionType} • {selected.status}</p>
              {selected.provider ? <p className="muted">Provider: {selected.provider.provider} ({selected.provider.mode})</p> : null}
              {selected.externalOrderId ? <p className="muted">Thyrocare DSA order ID: {selected.externalOrderId}</p> : null}

              <div className="form-stack">
                <Field label="Record Thyrocare DSA order ID / reference" htmlFor="lab-external-order-id">
                  <Input id="lab-external-order-id" value={externalOrderId} onChange={(event) => setExternalOrderId(event.target.value)} placeholder="THYROCARE-123" />
                </Field>
                <Button type="button" onClick={recordDsa} disabled={submitting || selected.status !== "PENDING_OPS"}>Record Thyrocare DSA order ID</Button>

                <Field label="Status" htmlFor="lab-status">
                  <select className="input" id="lab-status" value={status} onChange={(event) => setStatus(event.target.value)}>
                    {statusOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Status reason" htmlFor="lab-status-reason">
                  <Input id="lab-status-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Optional reason" />
                </Field>

                <Button type="button" onClick={saveStatus} disabled={submitting}>{submitting ? "Updating..." : "Update status"}</Button>

                <Field label="Operational note (Ops-only)" htmlFor="lab-ops-note">
                  <Input id="lab-ops-note" value={opsNote} onChange={(event) => setOpsNote(event.target.value)} placeholder="Internal DSA note (never shown to patients)" />
                </Field>
                <Button type="button" className="button-secondary" onClick={saveOpsNote} disabled={submitting || !opsNote.trim()}>Add note</Button>

                <Field label="Upload PDF report" htmlFor="lab-report-upload">
                  <Input id="lab-report-upload" type="file" accept=".pdf" onChange={uploadReport} />
                </Field>

                {selected.report ? (
                  <Button
                    type="button"
                    onClick={() => getAdminLabReport(selected.bookingId)
                      .then((report) => window.open(report.access.reference, "_blank", "noopener,noreferrer"))
                      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))}
                  >
                    Open report
                  </Button>
                ) : null}
                {reportFile ? <p className="muted">Selected: {reportFile.name}</p> : null}
              </div>
            </Panel>
          ) : null}
        </section>
      )}
    </main>
  );
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return "The lab booking request could not be completed.";
}