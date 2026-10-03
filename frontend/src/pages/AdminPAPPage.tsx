import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AdminPortalShell } from "../admin/AdminPortalShell";
import { AdminDetailPanel } from "../components/admin/AdminDetailPanel";
import { AdminFilterBar, AdminSelectFilter } from "../components/admin/AdminFilterBar";
import { StatusChip } from "../components/StatusChip";
import { Alert, Button, Field, Input, LoadingState } from "../components/ui";
import { formatDate, formatStatusLabel } from "../components/status-utils";
import type { Navigate } from "../components/navigation-types";
import {
  getAdminPapApplication,
  getAdminPapDocument,
  listAdminPapApplications,
  updatePapApplicationStatus,
  type PapApplication
} from "../pap/pap-api";

const statuses = ["UNDER_REVIEW", "MORE_INFORMATION_REQUIRED", "APPROVED", "REJECTED", "COMPLETED"];

/**
 * PAP operations (Phase 6.5): manual review workflow over the existing
 * admin PAP endpoints. Status filter is the server-side query the backend
 * exposes; document access uses the existing secure per-document endpoint.
 * There is no automated eligibility scoring and no invented approval logic —
 * the reviewer records the decision manually.
 */
export function AdminPAPPage({ navigate }: { navigate: Navigate }) {
  const { user } = useAuth();
  const [applications, setApplications] = useState<PapApplication[]>([]);
  const [selected, setSelected] = useState<PapApplication | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [status, setStatus] = useState("UNDER_REVIEW");
  const [reason, setReason] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    load(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filter applies via applyFilters
  }, []);

  function load(statusValue: string): void {
    setLoading(true);
    listAdminPapApplications(statusValue || undefined)
      .then((response) => {
        setApplications(response);
        setError(null);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        setError(describeError(requestError, "The PAP application queue could not be loaded."));
        setLoading(false);
      });
  }

  function refresh(): void {
    listAdminPapApplications(statusFilter || undefined)
      .then((response) => setApplications(response))
      .catch(() => undefined);
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    load(statusFilter);
  }

  function clearFilters(): void {
    setStatusFilter("");
    load("");
  }

  function openApplication(applicationId: string): void {
    setError(null);
    getAdminPapApplication(applicationId)
      .then((application) => {
        setSelected(application);
        setStatus(nextStatusFor(application.status));
        setReason(application.reviewReason ?? "");
        setReviewNotes(application.reviewNotes ?? "");
      })
      .catch((requestError: unknown) => setError(describeError(requestError, "That application could not be opened.")));
  }

  function saveReview(): void {
    if (!selected || saving) return; // one review submission at a time
    setSaving(true);
    setError(null);
    updatePapApplicationStatus(selected.applicationId, {
      status,
      reason: reason.trim() || undefined,
      reviewNotes: reviewNotes.trim() || undefined
    })
      .then((application) => {
        setSelected(application);
        setNotice(`Application moved to ${formatStatusLabel(application.status)}.`);
        refresh();
      })
      .catch((requestError: unknown) => setError(describeError(requestError, "The review could not be saved.")))
      .finally(() => setSaving(false));
  }

  function openDocument(applicationId: string, documentId: string): void {
    getAdminPapDocument(applicationId, documentId)
      .then((document) => window.open(document.access.reference, "_blank", "noopener,noreferrer"))
      .catch((requestError: unknown) => setError(describeError(requestError, "The document could not be opened.")));
  }

  if (!user) return null;

  return (
    <AdminPortalShell navigate={navigate} activePath="/admin/pap" title="PAP Navigator">
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}

      <div className="admin-sections">
        <section className="panel admin-queue-panel" aria-label="PAP application queue">
          <div className="queue-head">
            <h2>Applications</h2>
            <Button className="button-link" type="button" onClick={refresh}>
              Refresh
            </Button>
          </div>

          <AdminFilterBar onApply={applyFilters} onClear={clearFilters}>
            <AdminSelectFilter
              id="admin-pap-status"
              label="Application status"
              value={statusFilter}
              options={["SUBMITTED", "UNDER_REVIEW", "MORE_INFORMATION_REQUIRED", "APPROVED", "REJECTED", "COMPLETED"]}
              allLabel="All statuses"
              onChange={setStatusFilter}
            />
          </AdminFilterBar>

          {loading ? (
            <LoadingState label="Loading applications..." />
          ) : applications.length === 0 ? (
            <div className="empty-state-block" role="status">
              <p className="empty-state-title">
                {statusFilter
                  ? `No applications are currently ${formatStatusLabel(statusFilter).toLowerCase()}`
                  : "No PAP applications yet"}
              </p>
              <p className="empty-state-hint">
                {statusFilter
                  ? "Try another status or clear the filter."
                  : "Applications appear here as patients apply for assistance programs."}
              </p>
            </div>
          ) : (
            <div className="queue-list">
              {applications.map((application) => (
                <button
                  className="queue-row"
                  type="button"
                  key={application.applicationId}
                  onClick={() => openApplication(application.applicationId)}
                >
                  <div className="queue-row-main">
                    <strong>{application.patient.fullName}</strong>
                    <span className="muted">
                      {application.program.name} • submitted {formatDate(application.createdAt)}
                    </span>
                  </div>
                  <StatusChip status={application.status} />
                </button>
              ))}
            </div>
          )}
        </section>

        {selected ? (
          <AdminDetailPanel
            eyebrow={formatStatusLabel(selected.status)}
            title={selected.patient.fullName}
            meta={`${selected.program.name} • submitted ${formatDate(selected.createdAt)}`}
            onClose={() => setSelected(null)}
            rows={[
              { label: "Status", value: <StatusChip status={selected.status} /> },
              { label: "Phone", value: selected.applicationData.phone },
              { label: "Address", value: selected.applicationData.address },
              { label: "Diagnosis summary", value: selected.applicationData.diagnosisSummary },
              { label: "Household income", value: selected.applicationData.householdIncome },
              { label: "Financial need", value: selected.applicationData.financialNeed },
              { label: "Reviewed by", value: selected.reviewedBy ? selected.reviewedBy.fullName : "Not yet reviewed" },
              selected.reviewedAt ? { label: "Reviewed at", value: formatDate(selected.reviewedAt) } : null
            ].filter(Boolean) as { label: string; value: React.ReactNode }[]}
          >
            <h3>Submitted documents</h3>
            {selected.documents.length === 0 ? (
              <p className="empty-state">No documents submitted.</p>
            ) : (
              <div className="stack-list">
                {selected.documents.map((document) => (
                  <div className="list-row" key={document.documentId}>
                    <div>
                      <strong>{document.documentName}</strong>
                      <span className="muted">{document.mimeType} • {formatDate(document.uploadedAt)}</span>
                    </div>
                    <Button
                      className="button-secondary"
                      type="button"
                      onClick={() => openDocument(selected.applicationId, document.documentId)}
                    >
                      Open securely
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <h3 className="section-heading">Record review</h3>
            <div className="form-stack">
              <Field label="Review status" htmlFor="pap-review-status">
                <select className="input" id="pap-review-status" value={status} onChange={(event) => setStatus(event.target.value)}>
                  {statuses.map((value) => (
                    <option key={value} value={value}>{formatStatusLabel(value)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Reason" htmlFor="pap-review-reason" hint="Required by the backend when requesting more information or rejecting.">
                <Input id="pap-review-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
              </Field>
              <Field label="Review notes" htmlFor="pap-review-notes">
                <textarea
                  className="input textarea"
                  id="pap-review-notes"
                  value={reviewNotes}
                  onChange={(event) => setReviewNotes(event.target.value)}
                />
              </Field>
              <Button type="button" disabled={saving} onClick={saveReview}>
                {saving ? "Saving..." : "Save review"}
              </Button>
            </div>
          </AdminDetailPanel>
        ) : null}
      </div>
    </AdminPortalShell>
  );
}

function nextStatusFor(status: string): string {
  if (status === "SUBMITTED") return "UNDER_REVIEW";
  if (status === "UNDER_REVIEW") return "APPROVED";
  if (status === "MORE_INFORMATION_REQUIRED") return "UNDER_REVIEW";
  if (status === "APPROVED") return "COMPLETED";
  return status;
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
