import { useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatusChip } from "../components/StatusChip";
import { Alert, Button, ErrorState, LoadingState, Panel } from "../components/ui";
import type { Navigate } from "../components/navigation-types";
import { formatDateTime, formatStatusLabel } from "../components/status-utils";
import { ApiError } from "../api/client";
import {
  getReviewPrescription,
  reviewPrescription,
  type Prescription
} from "../pharmacy/pharmacy-api";
import { PharmacistPortalShell } from "../pharmacist/PharmacistPortalShell";

type ReviewAction = "verify" | "reject" | "query";
type ReviewTarget = { prescription: Prescription; action: ReviewAction };
type DocumentAccess = { reference: string; expiresAt: string };
type ReviewDetail = Prescription & {
  documentAccess?: DocumentAccess;
  reviewedByUserId?: string | null;
  reviewedAt?: string | null;
  reviewReason?: string | null;
};

/**
 * Pharmacist prescription verification (Phase 6.4): the PENDING_REVIEW queue
 * with an inline review drawer. Document access uses exactly the short-lived
 * reference the backend returns (documentAccess.reference) — no storage keys
 * are ever rendered. Reject/query require a reason (backend-enforced), all
 * actions confirm first, and repeated submissions are locked out. State
 * conflicts (someone already reviewed) surface as actionable errors.
 */
export function PharmacistVerificationPage({ navigate }: { navigate: Navigate }) {
  const [queue, setQueue] = useState<Prescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReviewDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ReviewTarget | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestTokenRef = useRef(0);

  useEffect(() => {
    const requestToken = ++requestTokenRef.current;
    import("../pharmacy/pharmacy-api")
      .then((module) => module.listReviewQueue().then((response) => response.items))
      .then((items) => {
        if (requestTokenRef.current !== requestToken) return;
        setQueue(items);
        setLoadError(null);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (requestTokenRef.current !== requestToken) return;
        setLoadError(toMessage(requestError, "The verification queue could not be loaded."));
        setLoading(false);
      });
    return () => {
      requestTokenRef.current += 1;
    };
  }, [reloadToken]);

  function refreshQueue(): void {
    setReloadToken((token) => token + 1);
  }

  function openPrescription(prescriptionId: string): void {
    setDetailError(null);
    setDetailLoading(true);
    setReason("");
    getReviewPrescription(prescriptionId)
      .then((detail) => {
        setSelected(detail);
        setDetailLoading(false);
      })
      .catch((requestError: unknown) => {
        setDetailError(toMessage(requestError, "That prescription could not be opened."));
        setDetailLoading(false);
      });
  }

  function closeDetail(): void {
    setSelected(null);
    setDetailError(null);
    setReasonError(null);
    setReason("");
  }

  function requestAction(action: ReviewAction): void {
    if (!selected || working) return;
    if (action !== "verify") {
      setReasonError(null);
      if (!reason.trim()) {
        setReasonError(
          action === "reject"
            ? "A rejection reason is required before the prescription leaves the queue."
            : "Describe what needs clarification so the patient can respond."
        );
        return;
      }
    }
    setPendingAction({ prescription: selected, action });
  }

  function runAction(): void {
    if (!pendingAction || working) return;
    const { prescription, action } = pendingAction;
    setWorking(true);
    reviewPrescription(prescription.id, action, action === "verify" ? undefined : reason.trim())
      .then(() => {
        setNotice(
          action === "verify"
            ? "Prescription verified. The patient can now order prescription items."
            : action === "reject"
              ? "Prescription rejected with your reason recorded."
              : "Clarification query sent with your reason recorded."
        );
        setPendingAction(null);
        closeDetail();
        refreshQueue();
      })
      .catch((requestError: unknown) => {
        setPendingAction(null);
        // 409 means another pharmacist already reviewed it: refresh so the
        // queue reflects reality instead of letting the stale row persist.
        if (requestError instanceof ApiError && requestError.status === 409) {
          setDetailError("This prescription was already reviewed by someone else. The queue has been refreshed.");
          refreshQueue();
          return;
        }
        setDetailError(toMessage(requestError, "The review action could not be saved."));
      })
      .finally(() => setWorking(false));
  }

  return (
    <PharmacistPortalShell navigate={navigate} activePath="/pharmacist?tab=verification">
      <section className="ops-command-hero" aria-label="Prescription verification">
        <p className="ops-hero-eyebrow">OncoEasy Pharmacy Fulfillment</p>
        <h2>Prescription verification</h2>
        <p>
          Review pending prescriptions, open the secure document, and approve, query, or reject.
          Verification unlocks patient checkout — every order starts here.
        </p>
      </section>

      <section className="ops-flow" aria-label="Fulfillment workflow">
        <div className={`ops-stage${queue.length > 0 ? " is-hot" : " is-idle"}`}>
          <span className="ops-stage-step">Stage 1</span>
          <span className="ops-stage-value">{loading ? "…" : queue.length}</span>
          <span className="ops-stage-label">Awaiting verification</span>
        </div>
        <div className="ops-stage is-idle">
          <span className="ops-stage-step">Stage 2</span>
          <span className="ops-stage-value">—</span>
          <span className="ops-stage-label">Approved for checkout</span>
        </div>
        <div className="ops-stage is-idle">
          <span className="ops-stage-step">Stage 3</span>
          <span className="ops-stage-value">—</span>
          <span className="ops-stage-label">Ready to pack</span>
        </div>
        <div className="ops-stage is-idle">
          <span className="ops-stage-step">Stage 4</span>
          <span className="ops-stage-value">—</span>
          <span className="ops-stage-label">Dispatched</span>
        </div>
        <div className="ops-stage is-idle">
          <span className="ops-stage-step">Stage 5</span>
          <span className="ops-stage-value">—</span>
          <span className="ops-stage-label">Delivered</span>
        </div>
      </section>

      <div className="portal-sections">
        {notice ? <div className="success-message" role="status">{notice}</div> : null}

        {loading ? (
          <Panel>
            <div aria-busy="true">
              <LoadingState label="Loading verification queue..." />
            </div>
          </Panel>
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={refreshQueue} />
        ) : (
          <section className="ops-card" aria-label="Verification queue">
            <div className="ops-card-head">
              <h2>
                Awaiting verification
                {queue.length > 0 ? <span className="dash-count">{queue.length}</span> : null}
              </h2>
              <Button className="button-secondary" type="button" onClick={refreshQueue}>
                Refresh queue
              </Button>
            </div>
            {queue.length === 0 ? (
              <div className="ops-empty" role="status">
                <p>
                  The queue is clear. No prescriptions are pending review. New patient uploads
                  appear here automatically on refresh.
                </p>
              </div>
            ) : (
              <ul className="ops-list">
                {queue.map((item) => (
                  <li key={item.id}>
                    <span className="ops-list-title">
                      {item.documentName}
                      <span className="ops-list-meta">
                        Patient {item.patientId?.slice(0, 8)} • uploaded {formatDateTime(item.createdAt)}
                      </span>
                      {item.notes ? <span className="ops-list-note">“{item.notes}”</span> : null}
                    </span>
                    <span className="ops-row-actions">
                      <StatusChip status={item.status} />
                      <Button
                        type="button"
                        onClick={() => openPrescription(item.id)}
                        disabled={detailLoading && selected?.id === item.id}
                      >
                        {detailLoading && selected?.id === item.id ? "Opening..." : "Review"}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {detailLoading ? (
          <Panel>
            <div aria-busy="true">
              <LoadingState label="Opening prescription..." />
            </div>
          </Panel>
        ) : detailError ? (
          <Alert>{detailError}</Alert>
        ) : null}

        {selected && !detailLoading ? (
          <Panel>
            <div className="detail-header">
              <div>
                <p className="eyebrow">Review</p>
                <h2>{selected.documentName}</h2>
              </div>
              <Button className="button-link" type="button" onClick={closeDetail}>
                Close
              </Button>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Status</dt>
                <dd><StatusChip status={selected.status} /></dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{formatStatusLabel(selected.source)}</dd>
              </div>
              <div>
                <dt>Uploaded</dt>
                <dd>{formatDateTime(selected.createdAt)}</dd>
              </div>
              {selected.notes ? (
                <div>
                  <dt>Patient notes</dt>
                  <dd>{selected.notes}</dd>
                </div>
              ) : null}
            </dl>

            {selected.documentAccess ? (
              <div className="document-access-box">
                <p className="field-hint">
                  Secure short-lived access. The document opens through the backend — storage
                  details are never exposed.
                </p>
                <a
                  className="button button-secondary"
                  href={selected.documentAccess.reference}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open prescription document
                </a>
              </div>
            ) : (
              <p className="muted">
                The secure document link could not be issued right now. Review actions remain
                available; you can reopen the prescription to retry document access.
              </p>
            )}

            {detailError ? <Alert>{detailError}</Alert> : null}

            {selected.status === "PENDING_REVIEW" ? (
              <div className="review-actions">
                <div className="review-reason">
                  <label htmlFor="review-reason-input">
                    Reason (required to reject or query)
                  </label>
                  <textarea
                    className="input textarea"
                    id="review-reason-input"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Explain the decision for the record"
                    rows={3}
                  />
                  {reasonError ? <p className="field-error" role="alert">{reasonError}</p> : null}
                </div>
                <div className="button-row">
                  <Button type="button" disabled={working} onClick={() => requestAction("verify")}>
                    Approve
                  </Button>
                  <Button className="button-secondary" type="button" disabled={working} onClick={() => requestAction("query")}>
                    Query patient
                  </Button>
                  <Button className="button-danger" type="button" disabled={working} onClick={() => requestAction("reject")}>
                    Reject
                  </Button>
                </div>
              </div>
            ) : (
              <p className="muted">
                This prescription is {formatStatusLabel(selected.status).toLowerCase()} — no
                further review actions are possible.
              </p>
            )}
            {selected.reviewedAt ? (
              <p className="muted">Last reviewed {formatDateTime(selected.reviewedAt)}.</p>
            ) : null}
          </Panel>
        ) : null}
      </div>

      <ConfirmDialog
        open={pendingAction !== null}
        busy={working}
        tone={pendingAction?.action === "reject" ? "danger" : "primary"}
        title={
          pendingAction?.action === "verify"
            ? "Approve this prescription?"
            : pendingAction?.action === "reject"
              ? "Reject this prescription?"
              : "Send a clarification query?"
        }
        description={
          pendingAction?.action === "verify"
            ? `${pendingAction.prescription.documentName} will be marked verified and the patient can order prescription items.`
            : pendingAction?.action === "reject"
              ? `${pendingAction.prescription.documentName} will be rejected with your recorded reason. This cannot be undone.`
              : pendingAction
                ? `${pendingAction.prescription.documentName} will move to query state with your reason recorded.`
                : ""
        }
        confirmLabel={
          pendingAction?.action === "verify" ? "Approve" : pendingAction?.action === "reject" ? "Reject" : "Send query"
        }
        onConfirm={runAction}
        onCancel={() => {
          if (working) return;
          setPendingAction(null);
        }}
      />
    </PharmacistPortalShell>
  );
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
