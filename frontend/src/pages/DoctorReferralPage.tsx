import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";
import {
  createReferral,
  getDoctorReferral,
  listDoctorReferrals,
  type Product,
  type Referral
} from "../referrals/referral-api";
import { listProducts } from "../pharmacy/pharmacy-api";

type Navigate = (path: string) => void;
type SelectedItem = { productId: string; quantity: number };

export function DoctorReferralPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [selectedReferral, setSelectedReferral] = useState<Referral | null>(null);
  const [patientId, setPatientId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [items, setItems] = useState<SelectedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listProducts({ pageSize: 100 }), listDoctorReferrals()])
      .then(([productResponse, referralResponse]) => {
        setProducts(productResponse.items);
        setReferrals(referralResponse);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, []);

  function signOutAndLeave(): void {
    signOut();
    navigate("/");
  }

  function addItem(): void {
    const product = products.find((item) => item.id === selectedProductId);
    if (!product) {
      setError("Select an active medicine first.");
      return;
    }
    if (quantity < product.minimumQuantity) {
      setError(`Quantity must be at least ${product.minimumQuantity}.`);
      return;
    }
    if (items.some((item) => item.productId === product.id)) {
      setError("That medicine is already included in this referral.");
      return;
    }
    setError(null);
    setItems((current) => [...current, { productId: product.id, quantity }]);
    setSelectedProductId("");
    setQuantity(1);
  }

  function submitReferral(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!patientId.trim() || items.length === 0) {
      setError("Enter a patient ID and add at least one medicine.");
      return;
    }
    setSubmitting(true);
    setError(null);
    createReferral(patientId.trim(), items)
      .then((referral) => {
        setReferrals((current) => [referral, ...current]);
        setSelectedReferral(referral);
        setAccessToken(referral.accessToken);
        setItems([]);
        setPatientId("");
        setNotice("Referral created. Share the access link manually with the patient.");
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSubmitting(false));
  }

  function openReferral(referralId: string): void {
    setError(null);
    getDoctorReferral(referralId)
      .then(setSelectedReferral)
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)));
  }

  if (!user) return null;
  return (
    <main className="workspace-page referral-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Doctor workspace</p>
          <h1>Medicine referrals</h1>
          <p className="intro">Create and track patient medicine referrals.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={signOutAndLeave}>Sign out</Button>
      </header>
      {loading ? <LoadingState label="Loading referral workspace..." /> : null}
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}
      {!loading ? <section className="referral-grid">
        <Panel>
          <h2>Create referral</h2>
          <p className="muted">The backend currently accepts a patient UUID. Patient directory lookup is not exposed in this phase.</p>
          <form className="form-stack" onSubmit={submitReferral}>
            <Field label="Patient ID" htmlFor="referral-patient-id" hint="Use the patient UUID from your authorized workflow.">
              <Input id="referral-patient-id" value={patientId} onChange={(event) => setPatientId(event.target.value)} placeholder="Patient UUID" />
            </Field>
            <div className="referral-item-picker">
              <Field label="Active medicine" htmlFor="referral-product">
                <select className="input" id="referral-product" value={selectedProductId} onChange={(event) => { setSelectedProductId(event.target.value); const product = products.find((item) => item.id === event.target.value); setQuantity(product?.minimumQuantity ?? 1); }}>
                  <option value="">Select a medicine</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>)}
                </select>
              </Field>
              <Field label="Quantity" htmlFor="referral-quantity">
                <Input id="referral-quantity" type="number" min={1} value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} />
              </Field>
              <Button type="button" className="button-secondary" onClick={addItem}>Add medicine</Button>
            </div>
            {items.length > 0 ? <div className="stack-list">{items.map((item) => { const product = products.find((candidate) => candidate.id === item.productId); return <div className="list-row" key={item.productId}><div><strong>{product?.name ?? item.productId}</strong><span className="muted">Quantity {item.quantity} • Minimum {product?.minimumQuantity ?? "backend validated"}</span></div><Button className="button-link" type="button" onClick={() => setItems((current) => current.filter((candidate) => candidate.productId !== item.productId))}>Remove</Button></div>; })}</div> : <p className="empty-state">No medicines selected.</p>}
            <Button type="submit" disabled={submitting || items.length === 0}>{submitting ? <LoadingState label="Creating referral..." /> : "Create referral"}</Button>
          </form>
        </Panel>
        <Panel>
          <h2>Your referrals</h2>
          {referrals.length === 0 ? <p className="empty-state">No referrals created yet.</p> : <div className="stack-list">{referrals.map((referral) => <button className="list-row list-row-button" type="button" key={referral.referralId} onClick={() => openReferral(referral.referralId)}><div><strong>{referral.referralId.slice(0, 8)}</strong><span className="muted">{referral.patient?.fullName ?? referral.patient?.patientId ?? "Patient"} • {referral.items.length} medicine(s)</span></div><span className="status">{referral.status}</span></button>)}</div>}
        </Panel>
        {selectedReferral ? <Panel><h2>Referral details</h2><p>Status: <strong>{selectedReferral.status}</strong></p><p className="muted">Referral ID: {selectedReferral.referralId}</p><div className="stack-list">{selectedReferral.items.map((item) => <div className="list-row" key={`${item.sku}-${item.quantity}`}><div><strong>{item.name}</strong><span className="muted">{item.sku} • Quantity {item.quantity}</span></div><span>{item.currency} {item.unitPrice}</span></div>)}</div>{accessToken ? <div className="access-token-box"><p className="field-hint">Share this secure access token manually. It is shown only after creation.</p><code>{accessToken}</code><Button type="button" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/patient/referral?token=${accessToken}`)}>Copy patient link</Button></div> : null}</Panel> : null}
      </section> : null}
    </main>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The referral request could not be completed.";
}
