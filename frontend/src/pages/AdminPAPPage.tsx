import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";
import {
  getAdminPapApplication,
  getAdminPapDocument,
  listAdminPapApplications,
  updatePapApplicationStatus,
  type PapApplication
} from "../pap/pap-api";

type Navigate = (path: string) => void;

const statuses = ["UNDER_REVIEW", "MORE_INFORMATION_REQUIRED", "APPROVED", "REJECTED", "COMPLETED"];

export function AdminPAPPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [applications, setApplications] = useState<PapApplication[]>([]);
  const [selected, setSelected] = useState<PapApplication | null>(null);
  const [status, setStatus] = useState("UNDER_REVIEW");
  const [reason, setReason] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    listAdminPapApplications()
      .then((response) => {
        setApplications(response);
        if (response[0]) setSelected(response[0]);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, []);

  function leave(): void {
    signOut();
    navigate("/");
  }

  function refresh(): void {
    listAdminPapApplications()
      .then((response) => {
        setApplications(response);
        if (selected) setSelected(response.find((item) => item.applicationId === selected.applicationId) ?? response[0] ?? null);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)));
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
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)));
  }

  function saveReview(): void {
    if (!selected) return;
    setSaving(true);
    setError(null);
    updatePapApplicationStatus(selected.applicationId, {
      status,
      reason: reason.trim() || undefined,
      reviewNotes: reviewNotes.trim() || undefined
    })
      .then((application) => {
        setSelected(application);
        setNotice(`Application moved to ${formatStatus(application.status)}.`);
        refresh();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSaving(false));
  }

  function openDocument(applicationId: string, documentId: string): void {
    getAdminPapDocument(applicationId, documentId)
      .then((document) => window.open(document.access.reference, "_blank", "noopener,noreferrer"))
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)));
  }

  if (!user) return null;

  return (
    <main className="workspace-page pap-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Operations admin</p>
          <h1>PAP Navigator</h1>
          <p className="intro">Review patient assistance applications and record manual decisions.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={leave}>Sign out</Button>
      </header>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}

      {loading ? <LoadingState label="Loading PAP applications..." /> : (
        <section className="pap-grid">
          <Panel>
            <h2>Application queue</h2>
            {applications.length === 0 ? <p className="empty-state">No PAP applications are waiting for review.</p> : (
              <div className="stack-list">
                {applications.map((application) => (
                  <button className="list-row list-row-button" type="button" key={application.applicationId} onClick={() => openApplication(application.applicationId)}>
                    <div><strong>{application.patient.fullName}</strong><span className="muted">{application.program.name} • {formatDate(application.createdAt)}</span></div>
                    <span className={`status status-${application.status.toLowerCase()}`}>{formatStatus(application.status)}</span>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          {selected ? (
            <Panel>
              <div className="detail-header"><div><h2>Application review</h2><p className="muted">{selected.patient.fullName} • {selected.program.name}</p></div><span className={`status status-${selected.status.toLowerCase()}`}>{formatStatus(selected.status)}</span></div>
              <dl className="detail-list">
                <dt>Phone</dt><dd>{selected.applicationData.phone}</dd>
                <dt>Address</dt><dd>{selected.applicationData.address}</dd>
                <dt>Diagnosis summary</dt><dd>{selected.applicationData.diagnosisSummary}</dd>
                <dt>Household income</dt><dd>{selected.applicationData.householdIncome}</dd>
                <dt>Financial need</dt><dd>{selected.applicationData.financialNeed}</dd>
              </dl>

              <h3>Submitted documents</h3>
              {selected.documents.length === 0 ? <p className="empty-state">No documents submitted.</p> : <div className="stack-list">{selected.documents.map((document) => <div className="list-row" key={document.documentId}><div><strong>{document.documentName}</strong><span className="muted">{document.mimeType} • {formatDate(document.uploadedAt)}</span></div><Button className="button-secondary" type="button" onClick={() => openDocument(selected.applicationId, document.documentId)}>Open securely</Button></div>)}</div>}

              <div className="form-stack">
                <Field label="Review status" htmlFor="pap-review-status"><select className="input" id="pap-review-status" value={status} onChange={(event) => setStatus(event.target.value)}>{statuses.map((value) => <option key={value} value={value}>{formatStatus(value)}</option>)}</select></Field>
                <Field label="Reason" htmlFor="pap-review-reason"><Input id="pap-review-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required for rejection or more information" /></Field>
                <Field label="Review notes" htmlFor="pap-review-notes"><textarea className="input textarea" id="pap-review-notes" value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} /></Field>
                <Button type="button" disabled={saving} onClick={saveReview}>{saving ? "Saving..." : "Save review"}</Button>
              </div>
            </Panel>
          ) : null}
        </section>
      )}
    </main>
  );
}

function nextStatusFor(status: string): string {
  if (status === "SUBMITTED") return "UNDER_REVIEW";
  if (status === "UNDER_REVIEW") return "APPROVED";
  if (status === "MORE_INFORMATION_REQUIRED") return "UNDER_REVIEW";
  if (status === "APPROVED") return "COMPLETED";
  return status;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function formatStatus(value: string): string {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The PAP review request could not be completed.";
}
