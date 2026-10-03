import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PatientPageShell } from "../shell/PatientPageShell";
import { Alert, BackLink, Button, Field, Input, LoadingState, PageIntro, Panel } from "../components/ui";
import { addPatientReferralToCart, getPatientReferral, referralTokenStorageKey, type Referral } from "../referrals/referral-api";

type Navigate = (path: string) => void;

export function PatientReferralPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [token, setToken] = useState(() => new URLSearchParams(window.location.search).get("token") ?? sessionStorage.getItem(referralTokenStorageKey) ?? "");
  const [referral, setReferral] = useState<Referral | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const queryToken = new URLSearchParams(window.location.search).get("token");
    if (queryToken) {
      sessionStorage.setItem(referralTokenStorageKey, queryToken);
      getPatientReferral(queryToken)
        .then((response) => setReferral(response))
        .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
        .finally(() => setLoading(false));
    }
  }, []);

  function loadReferral(accessToken = token.trim()): void {
    if (!accessToken) {
      setError("Enter the secure referral token from your doctor.");
      return;
    }
    setLoading(true);
    setError(null);
    getPatientReferral(accessToken)
      .then((response) => { setReferral(response); sessionStorage.setItem(referralTokenStorageKey, accessToken); })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }

  function addToCart(): void {
    const accessToken = token.trim();
    if (!accessToken || adding) return; // one referral-to-cart conversion at a time
    setAdding(true);
    setError(null);
    addPatientReferralToCart(accessToken)
      .then((referral) => {
        sessionStorage.setItem(referralTokenStorageKey, accessToken);
        setReferral(referral);
        setNotice(`${referral.items.length} referred medicine(s) added to your pharmacy cart. Referral status: ${referral.status}.`);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setAdding(false));
  }

  function leave(): void {
    signOut();
    navigate("/");
  }
  void leave;

  if (!user) return null;
  return (
    <PatientPageShell navigate={navigate} activePath="/patient/pharmacy" className="referral-page"
      backSlot={<BackLink navigate={navigate} fallback="/patient" label="Back to dashboard" />}>
      <PageIntro
        eyebrow="Patient referral"
        title="Referred medicines"
        description="Open a secure medicine referral and add it to your existing pharmacy cart."
        crumbs={[
          { label: "Dashboard", href: "/patient" },
          { label: "Referred medicines" }
        ]}
      />
      <Panel>
        <form className="referral-access-form" onSubmit={(event) => { event.preventDefault(); loadReferral(); }}>
          <Field label="Secure referral token" htmlFor="patient-referral-token" hint="Use the token shared by your doctor. It is not a patient or referral database ID.">
            <Input id="patient-referral-token" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste referral token" />
          </Field>
          <Button type="submit" disabled={loading}>{loading ? <LoadingState label="Opening referral..." /> : "Open referral"}</Button>
        </form>
      </Panel>
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}
      {referral ? <section className="referral-detail-grid"><Panel><div className="detail-header"><div><p className="eyebrow">Referral {referral.referralId.slice(0, 8)}</p><h2>{referral.doctor?.fullName ? `From ${referral.doctor.fullName}` : "Doctor referral"}</h2></div><span className="status">{referral.status}</span></div><div className="stack-list">{referral.items.map((item) => <div className="list-row" key={`${item.sku}-${item.quantity}`}><div><strong>{item.name}</strong><span className="muted">{item.sku}{item.unitLabel ? ` • ${item.unitLabel}` : ""}</span></div><strong>Quantity {item.quantity}</strong></div>)}</div>{referral.status === "SENT" || referral.status === "VIEWED" ? <Button type="button" disabled={adding} onClick={addToCart}>{adding ? <LoadingState label="Adding to cart..." /> : "Add referral medicines to cart"}</Button> : <p className="muted">This referral has already been ordered and cannot be added again.</p>}</Panel><Panel><h2>Next step</h2><p className="muted">Referred medicines use your existing pharmacy cart, pricing, delivery validation, and checkout flow.</p>{notice ? <Button type="button" onClick={() => navigate("/patient/pharmacy?tab=cart")}>Open pharmacy cart</Button> : null}<p className="field-hint">Referral status: {referral.status}</p></Panel></section> : null}
    </PatientPageShell>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The referral request could not be completed.";
}
