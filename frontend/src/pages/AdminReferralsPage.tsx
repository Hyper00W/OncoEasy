import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  getAdminReferral,
  listAdminReferrals,
  referralStatuses,
  type AdminReferral,
  type ReferralStatus
} from "../admin/admin-api";
import { Alert, Button, Field, LoadingState, Panel } from "../components/ui";

type Navigate = (path: string) => void;

const pageSize = 10;

export function AdminReferralsPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [referrals, setReferrals] = useState<AdminReferral[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize, total: 0, totalPages: 1 });
  const [selected, setSelected] = useState<AdminReferral | null>(null);
  const [statusFilter, setStatusFilter] = useState<ReferralStatus | "">("");
  const [query, setQuery] = useState<{ page: number; status: ReferralStatus | "" }>({ page: 1, status: "" });
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAdminReferrals({ page: query.page, pageSize, status: query.status || undefined })
      .then((response) => {
        setReferrals(response.items);
        setPagination(response.pagination);
        setError(null);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, [query]);

  function leave(): void {
    signOut();
    navigate("/");
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    setLoading(true);
    setQuery({ page: 1, status: statusFilter });
  }

  function openReferral(referralId: string): void {
    setOpening(true);
    setError(null);
    getAdminReferral(referralId)
      .then((referral) => {
        setSelected(referral);
        setReferrals((current) => current.map((item) => (item.referralId === referral.referralId ? referral : item)));
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setOpening(false));
  }

  if (!user) return null;

  return (
    <main className="workspace-page consultation-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Operations admin</p>
          <h1>Referral operations</h1>
          <p className="intro">Track doctor referrals through viewing, ordering, and fulfillment.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={leave}>Sign out</Button>
      </header>

      {error ? <Alert>{error}</Alert> : null}

      <section className="consultation-grid">
        <Panel>
          <h2>Referrals</h2>
          <form className="form-stack" onSubmit={applyFilters}>
            <Field label="Status" htmlFor="referrals-admin-status">
              <select className="input" id="referrals-admin-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ReferralStatus | "")}>
                <option value="">All statuses</option>
                {referralStatuses.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}
              </select>
            </Field>
            <Button type="submit">Apply filters</Button>
          </form>

          {loading ? (
            <LoadingState label="Loading referrals..." />
          ) : referrals.length === 0 ? (
            <p className="empty-state">No referrals match the current filters.</p>
          ) : (
            <div className="stack-list">
              {referrals.map((referral) => (
                <button className="list-row list-row-button" type="button" key={referral.referralId} onClick={() => openReferral(referral.referralId)}>
                  <div>
                    <strong>{referral.patient?.fullName ?? "Patient"} → {referral.items.length} item(s)</strong>
                    <span className="muted">{referral.doctor?.fullName ?? "Doctor"} • {formatDate(referral.createdAt)}</span>
                  </div>
                  <span className="status">{formatLabel(referral.status)}</span>
                </button>
              ))}
            </div>
          )}

          <div className="button-row">
            <Button className="button-secondary" type="button" disabled={loading || pagination.page <= 1} onClick={() => setQuery({ ...query, page: pagination.page - 1 })}>Previous</Button>
            <span className="field-hint">Page {pagination.page} of {Math.max(pagination.totalPages, 1)} • {pagination.total} referral(s)</span>
            <Button className="button-secondary" type="button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => setQuery({ ...query, page: pagination.page + 1 })}>Next</Button>
          </div>
        </Panel>

        {opening ? <LoadingState label="Loading referral..." /> : null}

        {selected ? (
          <Panel>
            <div className="detail-header">
              <div>
                <p className="eyebrow">{formatLabel(selected.status)}</p>
                <h2>Referral {selected.referralId.slice(0, 8)}</h2>
              </div>
              <Button className="button-secondary" type="button" onClick={() => setSelected(null)}>Close</Button>
            </div>
            <div className="stack-list">
              <p className="list-row"><strong>Doctor</strong><span>{selected.doctor?.fullName ?? "—"}</span></p>
              <p className="list-row"><strong>Patient</strong><span>{selected.patient?.fullName ?? "—"}</span></p>
              <p className="list-row"><strong>Created</strong><span>{formatDate(selected.createdAt)}</span></p>
              <p className="list-row"><strong>Viewed</strong><span>{selected.viewedAt ? formatDate(selected.viewedAt) : "Not yet viewed"}</span></p>
              <p className="list-row"><strong>Ordered</strong><span>{selected.orderedAt ? formatDate(selected.orderedAt) : "Not ordered"}</span></p>
              <p className="list-row"><strong>Fulfilled</strong><span>{selected.fulfilledAt ? formatDate(selected.fulfilledAt) : "Not fulfilled"}</span></p>
              {selected.order ? <p className="list-row"><strong>Linked order</strong><span>{selected.order.id.slice(0, 8)} • {formatLabel(selected.order.status)}</span></p> : null}
            </div>
            <h3>Items</h3>
            <div className="stack-list">
              {selected.items.map((item) => (
                <p className="list-row" key={`${selected.referralId}-${item.productId}`}>
                  <strong>{item.name}</strong>
                  <span>{item.quantity} × {item.unitPrice} {item.currency} / {item.unitLabel} ({item.sku})</span>
                </p>
              ))}
            </div>
          </Panel>
        ) : null}
      </section>
    </main>
  );
}

function formatLabel(value: string): string {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The referrals request could not be completed.";
}
