import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  getAdminReferral,
  listAdminReferrals,
  referralStatuses,
  type AdminReferral,
  type ReferralStatus
} from "../admin/admin-api";
import { AdminPortalShell } from "../admin/AdminPortalShell";
import { AdminDetailPanel } from "../components/admin/AdminDetailPanel";
import { AdminFilterBar, AdminSelectFilter } from "../components/admin/AdminFilterBar";
import { AdminPagination, AdminTable, type AdminColumn } from "../components/admin/AdminTable";
import { StatusChip } from "../components/StatusChip";
import { Button } from "../components/ui";
import type { Navigate } from "../components/navigation-types";
import { formatDateTime, formatStatusLabel } from "../components/status-utils";


const pageSize = 10;

/**
 * Referral monitoring (Phase 6.5). Read-only over the existing admin
 * referral endpoints: server-side status filter, pagination, and a detail
 * panel exposing the real status timeline (created → viewed → ordered →
 * fulfilled) with the linked pharmacy order when present.
 */
export function AdminReferralsPage({ navigate }: { navigate: Navigate }) {
  const { user } = useAuth();
  const [referrals, setReferrals] = useState<AdminReferral[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize, total: 0, totalPages: 1 });
  const [selected, setSelected] = useState<AdminReferral | null>(null);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState<{ page: number; status: string }>({ page: 1, status: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestTokenRef = useRef(0);

  useEffect(() => {
    const requestToken = ++requestTokenRef.current;
    listAdminReferrals({ page: query.page, pageSize, status: (query.status || undefined) as ReferralStatus | undefined })
      .then((response) => {
        if (requestTokenRef.current !== requestToken) return;
        setReferrals(response.items);
        setPagination(response.pagination);
        setError(null);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (requestTokenRef.current !== requestToken) return;
        setError(describeError(requestError, "The referrals queue could not be loaded."));
        setLoading(false);
      });
  }, [query]);

  function openReferral(referralId: string): void {
    setError(null);
    getAdminReferral(referralId)
      .then((referral) => {
        setSelected(referral);
        setReferrals((current) => current.map((item) => (item.referralId === referral.referralId ? referral : item)));
      })
      .catch((requestError: unknown) => setError(describeError(requestError, "That referral could not be opened.")));
  }

  const columns: AdminColumn<AdminReferral>[] = [
    {
      header: "Doctor",
      label: "Doctor",
      cell: (referral) => referral.doctor?.fullName ?? <span className="muted">—</span>
    },
    {
      header: "Patient",
      label: "Patient",
      cell: (referral) => referral.patient?.fullName ?? <span className="muted">—</span>
    },
    {
      header: "Items",
      label: "Items",
      cell: (referral) => String(referral.items.length)
    },
    {
      header: "Created",
      label: "Created",
      cell: (referral) => formatDateTime(referral.createdAt)
    },
    {
      header: "Order",
      label: "Order",
      cell: (referral) =>
        referral.order ? (
          <span className="mono">{referral.order.id.slice(0, 8)}</span>
        ) : (
          <span className="muted">Not ordered</span>
        )
    },
    {
      header: "Status",
      label: "Status",
      cell: (referral) => <StatusChip status={referral.status} />
    },
    {
      header: "Actions",
      hideHeader: true,
      label: "Actions",
      cell: (referral) => (
        <Button className="button-link" type="button" onClick={() => openReferral(referral.referralId)}>
          Details
        </Button>
      )
    }
  ];

  if (!user) return null;

  return (
    <AdminPortalShell navigate={navigate} activePath="/admin/referrals" title="Referrals">
      <div className="admin-sections">
        <section className="panel admin-queue-panel" aria-label="Referral queue">
          <div className="queue-head">
            <h2>All referrals</h2>
            <Button className="button-link" type="button" onClick={() => setQuery({ ...query })}>
              Refresh
            </Button>
          </div>
          <AdminFilterBar
            onApply={(event) => {
              event.preventDefault();
              setQuery({ page: 1, status });
            }}
            onClear={() => {
              setStatus("");
              setQuery({ page: 1, status: "" });
            }}
          >
            <AdminSelectFilter
              id="admin-referrals-status"
              label="Referral status"
              value={status}
              options={referralStatuses}
              allLabel="All statuses"
              onChange={setStatus}
            />
          </AdminFilterBar>

          <AdminTable
            columns={columns}
            rows={referrals}
            getKey={(referral) => referral.referralId}
            loading={loading}
            loadingLabel="Loading referrals..."
            emptyTitle="No referrals match this filter"
            emptyHint={query.status ? `No referrals are currently ${formatStatusLabel(query.status).toLowerCase()}.` : "Referrals appear here as doctors refer medicines to patients."}
            error={error}
            onRetry={() => setQuery({ ...query })}
          />

          <AdminPagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            singular="referral"
            plural="referrals"
            disabled={loading}
            onPrevious={() => setQuery({ ...query, page: pagination.page - 1 })}
            onNext={() => setQuery({ ...query, page: pagination.page + 1 })}
          />
        </section>

        {selected ? (
          <AdminDetailPanel
            eyebrow={formatStatusLabel(selected.status)}
            title={`Referral ${selected.referralId.slice(0, 8)}`}
            meta={`${selected.doctor?.fullName ?? "Doctor"} → ${selected.patient?.fullName ?? "Patient"}`}
            onClose={() => setSelected(null)}
            rows={[
              { label: "Status", value: <StatusChip status={selected.status} /> },
              { label: "Created", value: formatDateTime(selected.createdAt) },
              { label: "Viewed", value: selected.viewedAt ? formatDateTime(selected.viewedAt) : "Not yet viewed" },
              { label: "Ordered", value: selected.orderedAt ? formatDateTime(selected.orderedAt) : "Not ordered" },
              { label: "Fulfilled", value: selected.fulfilledAt ? formatDateTime(selected.fulfilledAt) : "Not fulfilled" },
              selected.order
                ? { label: "Linked order", value: `${selected.order.id.slice(0, 8)} • ${formatStatusLabel(selected.order.status)}` }
                : null
            ].filter(Boolean) as { label: string; value: React.ReactNode }[]}
          >
            <h3>Items</h3>
            <div className="stack-list">
              {selected.items.map((item) => (
                <div className="list-row" key={`${selected.referralId}-${item.productId}`}>
                  <div>
                    <strong>{item.name}</strong>
                    <span className="muted">{item.sku}{item.unitLabel ? ` • ${item.unitLabel}` : ""} • Quantity {item.quantity}</span>
                  </div>
                  <span>{item.currency} {item.unitPrice}</span>
                </div>
              ))}
            </div>
          </AdminDetailPanel>
        ) : null}
      </div>
    </AdminPortalShell>
  );
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
