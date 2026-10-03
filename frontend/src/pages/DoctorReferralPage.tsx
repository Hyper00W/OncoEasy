import { useEffect, useRef, useState } from "react";

import { StatusChip } from "../components/StatusChip";
import { Alert, Button, ErrorState, Field, Input, LoadingState, Panel } from "../components/ui";
import type { Navigate } from "../components/navigation-types";
import { formatDateTime, formatStatusLabel } from "../components/status-utils";
import { listProducts } from "../pharmacy/pharmacy-api";
import type { Product } from "../pharmacy/pharmacy-api";
import {
  createReferral,
  getDoctorReferral,
  listDoctorReferrals,
  type CreatedReferral,
  type Referral
} from "../referrals/referral-api";
import { DoctorPortalShell } from "../doctor/DoctorPortalShell";

type SelectedItem = { productId: string; quantity: number };

/**
 * Doctor referral workflow (Phase 6.4). Preserves the existing backend
 * contract exactly: referrals take a patient UUID plus product/quantity
 * pairs; the access token is shown once after creation. Duplicate submits
 * are blocked at the button level and the picker validates minimum
 * quantities with the same rules the backend enforces.
 */
export function DoctorReferralPage({ navigate }: { navigate: Navigate }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [selectedReferral, setSelectedReferral] = useState<Referral | null>(null);
  const [patientId, setPatientId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [items, setItems] = useState<SelectedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const submitLockRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listProducts({ pageSize: 100 }), listDoctorReferrals()])
      .then(([productResponse, referralResponse]) => {
        if (cancelled) return;
        setProducts(productResponse.items);
        setReferrals(referralResponse);
        setLoadError(null);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setLoadError(
          requestError instanceof Error && requestError.name === "ApiError"
            ? requestError.message
            : "The referral workspace could not be loaded."
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function addItem(): void {
    const product = products.find((item) => item.id === selectedProductId);
    if (!product) {
      setFormError("Select an active medicine first.");
      return;
    }
    if (quantity < product.minimumQuantity) {
      setFormError(`Quantity must be at least ${product.minimumQuantity} for ${product.name}.`);
      return;
    }
    if (items.some((item) => item.productId === product.id)) {
      setFormError("That medicine is already included in this referral.");
      return;
    }
    setFormError(null);
    setItems((current) => [...current, { productId: product.id, quantity }]);
    setSelectedProductId("");
    setQuantity(1);
  }

  function submitReferral(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submitLockRef.current || submitting) return;
    if (!patientId.trim() || items.length === 0) {
      setFormError("Enter a patient ID and add at least one medicine.");
      return;
    }
    submitLockRef.current = true;
    setSubmitting(true);
    setFormError(null);
    setNotice(null);
    createReferral(patientId.trim(), items)
      .then((referral: CreatedReferral) => {
        setReferrals((current) => [referral, ...current]);
        setSelectedReferral(referral);
        setAccessToken(referral.accessToken);
        setItems([]);
        setPatientId("");
        setNotice("Referral created. Share the secure access link with the patient.");
      })
      .catch((requestError: unknown) => {
        setFormError(
          requestError instanceof Error && requestError.name === "ApiError"
            ? requestError.message
            : "The referral could not be created. Your inputs are preserved — try again."
        );
      })
      .finally(() => {
        submitLockRef.current = false;
        setSubmitting(false);
      });
  }

  function openReferral(referralId: string): void {
    getDoctorReferral(referralId)
      .then(setSelectedReferral)
      .catch(() => setNotice("That referral could not be opened. Refresh and try again."));
  }

  return (
    <DoctorPortalShell navigate={navigate} activePath="/doctor/referrals">
      <header className="portal-hero">
        <p className="portal-hero-eyebrow">Doctor workspace</p>
        <h1>Medicine referrals</h1>
        <p className="portal-hero-copy">
          Refer medicines to a patient; they order through the pharmacy at standard pricing.
        </p>
      </header>

      {loading ? (
        <div className="portal-sections" aria-hidden="true">
          <div className="skeleton skeleton-hero" />
          <div className="skeleton skeleton-card" />
        </div>
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={() => setReloadToken((token) => token + 1)} />
      ) : (
        <div className="portal-sections">
          {notice ? (
            <div className="success-message" role="status">{notice}</div>
          ) : null}

          <div className="referral-grid">
            <Panel>
              <h2>Create referral</h2>
              <p className="muted">
                The backend currently accepts a patient UUID. Patient directory lookup is not
                exposed in this phase.
              </p>
              <form className="form-stack" onSubmit={submitReferral}>
                <Field
                  label="Patient ID"
                  htmlFor="referral-patient-id"
                  hint="Use the patient UUID from your authorized workflow."
                >
                  <Input
                    id="referral-patient-id"
                    value={patientId}
                    onChange={(event) => setPatientId(event.target.value)}
                    placeholder="Patient UUID"
                    autoComplete="off"
                  />
                </Field>
                <div className="referral-item-picker">
                  <Field label="Active medicine" htmlFor="referral-product">
                    <select
                      className="input"
                      id="referral-product"
                      value={selectedProductId}
                      onChange={(event) => {
                        setSelectedProductId(event.target.value);
                        const product = products.find((item) => item.id === event.target.value);
                        setQuantity(product?.minimumQuantity ?? 1);
                      }}
                    >
                      <option value="">Select a medicine</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name} ({product.sku})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Quantity" htmlFor="referral-quantity">
                    <Input
                      id="referral-quantity"
                      type="number"
                      min={1}
                      value={quantity}
                      onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
                    />
                  </Field>
                  <Button type="button" className="button-secondary" onClick={addItem}>
                    Add medicine
                  </Button>
                </div>
                {formError ? <Alert>{formError}</Alert> : null}
                {items.length > 0 ? (
                  <div className="stack-list">
                    {items.map((item) => {
                      const product = products.find((candidate) => candidate.id === item.productId);
                      return (
                        <div className="list-row" key={item.productId}>
                          <div>
                            <strong>{product?.name ?? item.productId}</strong>
                            <span className="muted">
                              Quantity {item.quantity} • Minimum {product?.minimumQuantity ?? "backend validated"}
                            </span>
                          </div>
                          <Button
                            className="button-link"
                            type="button"
                            onClick={() =>
                              setItems((current) => current.filter((candidate) => candidate.productId !== item.productId))
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="empty-state">No medicines selected yet.</p>
                )}
                <Button type="submit" disabled={submitting || items.length === 0 || !patientId.trim()}>
                  {submitting ? <LoadingState label="Creating referral..." /> : "Create referral"}
                </Button>
              </form>
            </Panel>

            <Panel>
              <h2>Your referrals</h2>
              {referrals.length === 0 ? (
                <div className="empty-state-block" role="status">
                  <p className="empty-state-title">No referrals yet</p>
                  <p className="empty-state-hint">
                    Create your first referral with the form. Patients receive a secure link to
                    order the medicines.
                  </p>
                </div>
              ) : (
                <div className="stack-list">
                  {referrals.map((referral) => (
                    <button
                      className="list-row list-row-button"
                      type="button"
                      key={referral.referralId}
                      onClick={() => openReferral(referral.referralId)}
                    >
                      <div>
                        <strong>{referral.patient?.fullName ?? referral.patient?.patientId ?? "Patient"}</strong>
                        <span className="muted">
                          {referral.items.length} medicine{referral.items.length === 1 ? "" : "s"} •{" "}
                          {formatDateTime(referral.createdAt)}
                        </span>
                      </div>
                      <StatusChip status={referral.status} />
                    </button>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          {selectedReferral ? (
            <Panel>
              <div className="detail-header">
                <div>
                  <p className="eyebrow">Referral {selectedReferral.referralId.slice(0, 8)}</p>
                  <h2>{selectedReferral.patient?.fullName ?? "Referral details"}</h2>
                </div>
                <StatusChip status={selectedReferral.status} />
              </div>
              <dl className="detail-list">
                <div>
                  <dt>Status</dt>
                  <dd>{formatStatusLabel(selectedReferral.status)}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDateTime(selectedReferral.createdAt)}</dd>
                </div>
                {selectedReferral.viewedAt ? (
                  <div>
                    <dt>Viewed by patient</dt>
                    <dd>{formatDateTime(selectedReferral.viewedAt)}</dd>
                  </div>
                ) : null}
                {selectedReferral.orderedAt ? (
                  <div>
                    <dt>Ordered</dt>
                    <dd>{formatDateTime(selectedReferral.orderedAt)}</dd>
                  </div>
                ) : null}
                {selectedReferral.order ? (
                  <div>
                    <dt>Pharmacy order</dt>
                    <dd>{selectedReferral.order.id.slice(0, 8)} • {formatStatusLabel(selectedReferral.order.status)}</dd>
                  </div>
                ) : null}
              </dl>
              <div className="stack-list">
                {selectedReferral.items.map((item) => (
                  <div className="list-row" key={`${item.sku}-${item.quantity}`}>
                    <div>
                      <strong>{item.name}</strong>
                      <span className="muted">
                        {item.sku} • Quantity {item.quantity}
                      </span>
                    </div>
                    <span>
                      {item.currency} {item.unitPrice}
                    </span>
                  </div>
                ))}
              </div>
              {accessToken ? (
                <div className="access-token-box">
                  <p className="field-hint">
                    Share this secure access token manually with the patient. It is shown only
                    once, right after creation.
                  </p>
                  <code>{accessToken}</code>
                  <Button
                    type="button"
                    onClick={() =>
                      navigator.clipboard?.writeText(
                        `${window.location.origin}/patient/referral?token=${accessToken}`
                      )
                    }
                  >
                    Copy patient link
                  </Button>
                </div>
              ) : null}
            </Panel>
          ) : null}
        </div>
      )}
    </DoctorPortalShell>
  );
}
