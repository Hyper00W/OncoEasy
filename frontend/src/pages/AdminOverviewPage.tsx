import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  getAdminOverview,
  listAdminReferrals,
  listAdminAppointments,
  type AdminOverview
} from "../admin/admin-api";
import { loadAdminOpsSnapshot, type AdminOpsSnapshot } from "../admin/admin-ops-api";
import { AdminPortalShell, AdminCommandHero } from "../admin/AdminPortalShell";
import { AdminTable, type AdminColumn } from "../components/admin/AdminTable";
import { StatusChip } from "../components/StatusChip";
import { Alert, ErrorState } from "../components/ui";
import type { Navigate } from "../components/navigation-types";
import { formatDateTime } from "../components/status-utils";
import {
  ActivityIcon,
  ArrowRightIcon,
  ClipboardCheckIcon,
  DocumentIcon,
  FlaskIcon,
  MessageCircleIcon,
  PillIcon,
  ShieldHeartIcon,
  StethoscopeIcon,
  TrendUpIcon,
  TruckIcon
} from "../components/icons";
import type { AdminReferral, AdminAppointment } from "../admin/admin-api";

/**
 * OncoEasy Operations Command Center (admin overview). Primary metrics come
 * from the existing GET /api/v1/admin/overview aggregator; live queues
 * (prescription review, referrals, consultations, orders, deliveries) render
 * from their real list endpoints. Every section fails independently so one
 * API error never blanks the console. No metric is invented: the overview API
 * defines the numbers.
 */
export function AdminOverviewPage({ navigate }: { navigate: Navigate }) {
  const { user } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [ops, setOps] = useState<AdminOpsSnapshot | null>(null);
  const [referrals, setReferrals] = useState<AdminReferral[] | null>(null);
  const [appointments, setAppointments] = useState<AdminAppointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [referralsError, setReferralsError] = useState<string | null>(null);
  const [appointmentsError, setAppointmentsError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getAdminOverview()
      .then((response) => {
        if (cancelled) return;
        setOverview(response);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setError(describeError(requestError, "The operations overview could not be loaded."));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    let cancelled = false;
    loadAdminOpsSnapshot()
      .then((snapshot) => {
        if (cancelled) return;
        setOps(snapshot);
        setOpsError(null);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setOpsError(describeError(requestError, "Pharmacy queues could not be loaded."));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    let cancelled = false;
    listAdminReferrals({ page: 1, pageSize: 5 })
      .then((response) => {
        if (cancelled) return;
        setReferrals(response.items);
        setReferralsError(null);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setReferralsError(describeError(requestError, "Referrals could not be loaded."));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    let cancelled = false;
    listAdminAppointments({ page: 1, pageSize: 5 })
      .then((response) => {
        if (cancelled) return;
        setAppointments(response.items);
        setAppointmentsError(null);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setAppointmentsError(describeError(requestError, "Consultations could not be loaded."));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  if (!user) return null;

  return (
    <AdminPortalShell
      navigate={navigate}
      activePath="/admin"
      title="Operations command center"
      actions={
        <button
          className="button button-secondary"
          type="button"
          onClick={() => setReloadToken((token) => token + 1)}
        >
          Refresh
        </button>
      }
    >
      <AdminCommandHero
        title={`Good to see you, ${user.fullName?.split(" ")[0] || "there"}. Here is the pulse of operations today.`}
      >
        Live queues across pharmacy, care coordination and content — every number on this page comes
        from the real operations feed.
      </AdminCommandHero>

      {error && !overview ? (
        <ErrorState message={error} onRetry={() => setReloadToken((token) => token + 1)} />
      ) : !overview ? (
        <div className="ops-kpi-grid" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <div className="ops-kpi" key={index}>
              <span className="skeleton skeleton-text" style={{ width: "40%" }} />
              <span className="skeleton skeleton-text" style={{ width: "55%", height: 28 }} />
              <span className="skeleton skeleton-text" style={{ width: "70%" }} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <section className="ops-kpi-grid" aria-label="Pending work summary">
            <KpiCard
              index={0}
              label="Pending prescriptions"
              value={overview.pendingPrescriptionReviews}
              hint="Awaiting pharmacist verification"
              icon={<ClipboardCheckIcon size={17} />}
              tone={overview.pendingPrescriptionReviews > 0 ? "amber" : "teal"}
              onClick={() => navigate("/admin/pharmacy")}
              actionLabel="Open review queue"
            />
            <KpiCard
              index={1}
              label="Pending orders"
              value={overview.pendingOrders}
              hint="Moving through fulfillment"
              icon={<PillIcon size={17} />}
              onClick={() => navigate("/admin/pharmacy")}
              actionLabel="Pharmacy & orders"
            />
            <KpiCard
              index={2}
              label="Active deliveries"
              value={overview.activeDeliveries}
              hint="Out with agents & couriers"
              icon={<TruckIcon size={17} />}
              tone="teal"
              onClick={() => navigate("/admin/pharmacy")}
              actionLabel="Delivery queue"
            />
            <KpiCard
              index={3}
              label="Pending referrals"
              value={overview.pendingReferrals}
              hint="Awaiting patient action"
              icon={<DocumentIcon size={17} />}
              onClick={() => navigate("/admin/referrals")}
              actionLabel="Referrals"
            />
            <KpiCard
              index={4}
              label="Active consultations"
              value={overview.upcomingConsultations}
              hint="Confirmed & upcoming visits"
              icon={<StethoscopeIcon size={17} />}
              onClick={() => navigate("/admin/consultations")}
              actionLabel="Consultations"
            />
            <KpiCard
              index={5}
              label="Lab requests"
              value={overview.pendingLabBookings}
              hint="Bookings to schedule"
              icon={<FlaskIcon size={17} />}
              onClick={() => navigate("/admin/labs")}
              actionLabel="Labs & scans"
            />
            <KpiCard
              index={6}
              label="PAP applications"
              value={overview.papApplicationsRequiringAttention}
              hint="Need a coordinator decision"
              icon={<ShieldHeartIcon size={17} />}
              tone={overview.papApplicationsRequiringAttention > 0 ? "amber" : "teal"}
              onClick={() => navigate("/admin/pap")}
              actionLabel="PAP Navigator"
            />
            <KpiCard
              index={7}
              label="Escalated chats"
              value={overview.escalatedChatSessions}
              hint="Care team follow-up"
              icon={<MessageCircleIcon size={17} />}
              onClick={() => navigate("/admin/chat")}
              actionLabel="Chat escalations"
            />
          </section>

          <div className="ops-zone-title">
            <h2>Operations signal</h2>
          </div>
          <div className="ops-trend">
            <OrderActivityCard orders={ops?.orders ?? null} error={opsError} />
            <section className="ops-card ops-actions" aria-label="Urgent actions">
              <div className="ops-card-head">
                <h2>Urgent actions</h2>
              </div>
              <UrgentActions overview={overview} navigate={navigate} />
            </section>
          </div>

          <div className="ops-zone-title">
            <h2>Recent orders</h2>
            <button className="link-button" type="button" onClick={() => navigate("/admin/pharmacy")}>
              Open pharmacy & orders →
            </button>
          </div>
          <OrdersTable orders={ops?.orders ?? null} error={opsError} navigate={navigate} />

          <div className="ops-zone-title">
            <h2>Care coordination</h2>
          </div>
          <div className="portal-columns">
            <QueuePanel
              title="Prescription verification queue"
              navigate={navigate}
              route="/admin/pharmacy"
              error={opsError}
              count={ops?.reviewQueue.length}
            >
              {ops === null ? (
                <SkeletonList rows={4} />
              ) : ops.reviewQueue.length === 0 ? (
                <p className="ops-empty">No prescriptions are pending review.</p>
              ) : (
                <ul className="ops-list">
                  {ops.reviewQueue.slice(0, 5).map((item) => (
                    <li key={item.id}>
                      <span className="ops-list-title">
                        {item.documentName}
                        <span className="ops-list-meta">Uploaded {formatDateTime(item.createdAt)}</span>
                      </span>
                      <StatusChip status={item.status} />
                    </li>
                  ))}
                </ul>
              )}
            </QueuePanel>

            <QueuePanel
              title="Upcoming consultations"
              navigate={navigate}
              route="/admin/consultations"
              error={appointmentsError}
              count={appointments?.length}
            >
              {appointments === null ? (
                <SkeletonList rows={4} />
              ) : appointments.length === 0 ? (
                <p className="ops-empty">No consultations booked yet.</p>
              ) : (
                <ul className="ops-list">
                  {appointments.slice(0, 5).map((appointment) => (
                    <li key={appointment.appointmentId}>
                      <span className="ops-list-title">
                        {appointment.patient.fullName}
                        <span className="ops-list-meta">{formatDateTime(appointment.scheduledAt)}</span>
                      </span>
                      <StatusChip status={appointment.status} />
                    </li>
                  ))}
                </ul>
              )}
            </QueuePanel>
          </div>

          <div className="ops-zone-title">
            <h2>Latest referrals</h2>
            <button className="link-button" type="button" onClick={() => navigate("/admin/referrals")}>
              Open referrals →
            </button>
          </div>
          <section className="ops-card" aria-label="Latest referrals">
            <div className="ops-card-head">
              <h2>Referral activity</h2>
            </div>
            {referralsError ? <Alert>{referralsError}</Alert> : null}
            {referrals === null ? (
              <SkeletonList rows={4} />
            ) : referrals.length === 0 ? (
              <p className="ops-empty">No referrals have been created yet.</p>
            ) : (
              <ul className="ops-list">
                {referrals.slice(0, 5).map((referral) => (
                  <li key={referral.referralId}>
                    <span className="ops-list-title">
                      {referral.doctor?.fullName ?? "Doctor"} → {referral.patient?.fullName ?? "Patient"}
                      <span className="ops-list-meta">
                        {referral.items.length} medicine{referral.items.length === 1 ? "" : "s"} •{" "}
                        {referral.order ? "Order placed" : "Awaiting order"}
                      </span>
                    </span>
                    <StatusChip status={referral.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <DemandForecastTeaser navigate={navigate} />
        </>
      )}
    </AdminPortalShell>
  );
}

/* -------------------------------------------------------------------------- */

function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = "indigo",
  onClick,
  actionLabel,
  index = 0
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
  tone?: "indigo" | "amber" | "teal" | "green" | "red";
  onClick: () => void;
  actionLabel: string;
  index?: number;
}) {
  return (
    <button
      className={`ops-kpi${tone !== "indigo" ? ` ops-kpi-tone-${tone}` : ""}`}
      type="button"
      onClick={onClick}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <span className="ops-kpi-top">
        <span className="ops-kpi-label">{label}</span>
        <span className="ops-kpi-icon" aria-hidden="true">{icon}</span>
      </span>
      <span className="ops-kpi-value">{value}</span>
      <span className="ops-kpi-hint">{hint}</span>
      <span className="ops-kpi-go">
        {actionLabel} <ArrowRightIcon size={13} />
      </span>
    </button>
  );
}

/** 12-day order activity band derived from the recent orders snapshot. */
function OrderActivityCard({ orders, error }: { orders: AdminOpsSnapshot["orders"] | null; error: string | null }) {
  const days = buildActivityBands(orders);
  const max = Math.max(1, ...days.map((day) => day.count));
  const total = orders?.length ?? 0;

  return (
    <section className="ops-card" aria-label="Order activity">
      <div className="ops-card-head">
        <h2>
          <span className="ops-card-icon" aria-hidden="true"><ActivityIcon size={16} /></span>
          Order activity
          <span className="ops-card-kicker">latest {total} orders</span>
        </h2>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {days.length === 0 ? (
        <div className="ops-sparkband-empty">No order activity recorded yet.</div>
      ) : (
        <div className="ops-sparkband" role="img" aria-label={`Order volume across the last ${days.length} days`}>
          {days.map((day) => (
            <span
              key={day.key}
              title={`${day.label}: ${day.count} order${day.count === 1 ? "" : "s"}`}
              style={{
                "--h": String(Math.round((day.count / max) * 100)),
                "--i": String(day.index)
              } as React.CSSProperties}
            />
          ))}
        </div>
      )}
      <p className="ops-card-sub" style={{ marginTop: 12, marginBottom: 0 }}>
        Volume is derived from the operations order feed — no synthetic data.
      </p>
    </section>
  );
}

function buildActivityBands(orders: AdminOpsSnapshot["orders"] | null) {
  if (!orders || orders.length === 0) return [];
  const buckets = new Map<string, { count: number; label: string }>();
  for (const order of orders) {
    const date = new Date(order.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = date.toISOString().slice(0, 10);
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(key, { count: 1, label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) });
    }
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([key, value], index) => ({ key, ...value, index }));
}

function UrgentActions({
  overview,
  navigate
}: {
  overview: AdminOverview;
  navigate: Navigate;
}) {
  const actions = [
    {
      rail: overview.pendingPrescriptionReviews > 0 ? "rail-amber" : "rail-teal",
      countTone: overview.pendingPrescriptionReviews > 0 ? "count-amber" : "count-zero",
      label: "Verify prescriptions",
      meta: "Pharmacist verification queue",
      count: overview.pendingPrescriptionReviews,
      route: "/admin/pharmacy"
    },
    {
      rail: "rail-teal",
      countTone: overview.pendingReferrals > 0 ? "count-teal" : "count-zero",
      label: "Chase pending referrals",
      meta: "Patients yet to act",
      count: overview.pendingReferrals,
      route: "/admin/referrals"
    },
    {
      rail: "rail-teal",
      countTone: overview.papApplicationsRequiringAttention > 0 ? "count-teal" : "count-zero",
      label: "Review PAP applications",
      meta: "Coordinator decisions",
      count: overview.papApplicationsRequiringAttention,
      route: "/admin/pap"
    },
    {
      rail: overview.escalatedChatSessions > 0 ? "rail-red" : "rail-teal",
      countTone: overview.escalatedChatSessions > 0 ? "count-red" : "count-zero",
      label: "Answer escalated chats",
      meta: "Care team follow-up",
      count: overview.escalatedChatSessions,
      route: "/admin/chat"
    },
    {
      rail: "rail-teal",
      countTone: overview.storiesAwaitingReview > 0 ? "count-amber" : "count-zero",
      label: "Review patient stories",
      meta: "Content moderation",
      count: overview.storiesAwaitingReview,
      route: "/admin/stories"
    }
  ];

  return (
    <div>
      {actions.map((action) => (
        <button className="ops-action-row" type="button" key={action.label} onClick={() => navigate(action.route)}>
          <span className={`ops-action-rail ${action.rail}`} aria-hidden="true" />
          <span className="ops-action-body">
            <span className="ops-action-title">{action.label}</span>
            <span className="ops-action-meta">{action.meta}</span>
          </span>
          <span className={`ops-action-count ${action.countTone}`}>{action.count}</span>
        </button>
      ))}
    </div>
  );
}

function OrdersTable({
  orders,
  error,
  navigate
}: {
  orders: AdminOpsSnapshot["orders"] | null;
  error: string | null;
  navigate: Navigate;
}) {
  const columns: AdminColumn<AdminOpsSnapshot["orders"][number]>[] = [
    {
      header: "Order",
      cell: (order) => (
        <div>
          <span className="mono">{order.id.slice(0, 8)}</span>
          <span className="table-subtext">{formatDateTime(order.createdAt)}</span>
        </div>
      )
    },
    { header: "Patient", cell: (order) => order.patient.fullName },
    { header: "Items", cell: (order) => String(order.items.length) },
    { header: "Total", cell: (order) => `${order.currency} ${order.totalAmount}` },
    { header: "Status", cell: (order) => <StatusChip status={order.status} /> },
    {
      header: "Actions",
      hideHeader: true,
      cell: () => (
        <button className="button button-link" type="button" onClick={() => navigate("/admin/pharmacy")}>
          Details
        </button>
      )
    }
  ];

  if (error && !orders) {
    return <Alert>{error}</Alert>;
  }

  return (
    <AdminTable
      columns={columns}
      rows={orders ?? []}
      getKey={(order) => order.id}
      loading={orders === null}
      loadingLabel="Loading orders..."
      emptyTitle="No pharmacy orders yet"
      emptyHint="Orders appear here once patients move through the pharmacy."
    />
  );
}

function DemandForecastTeaser({ navigate }: { navigate: Navigate }) {
  return (
    <section className="ops-card" aria-label="Demand Forecast Engine">
      <div className="ops-card-head">
        <h2>
          <span className="ops-card-icon" aria-hidden="true"><TrendUpIcon size={16} /></span>
          Demand Forecast Engine
        </h2>
        <button className="button button-secondary" type="button" onClick={() => navigate("/admin/forecasts")}>
          Open forecast workspace
        </button>
      </div>
      <p className="ops-card-sub" style={{ marginBottom: 0 }}>
        The statistical engine derives 7/14/30-day demand from delivered-order history — stock risks,
        fast movers, and reorder signals live in the full workspace.
      </p>
    </section>
  );
}

function QueuePanel({
  title,
  route,
  navigate,
  error,
  count,
  children
}: {
  title: string;
  route: string;
  navigate: Navigate;
  error: string | null;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="ops-card" aria-label={title}>
      <div className="ops-card-head">
        <h2>
          {title}
          {typeof count === "number" && count > 0 ? <span className="dash-count">{count}</span> : null}
        </h2>
        <button className="link-button" type="button" onClick={() => navigate(route)}>
          Open
        </button>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {children}
    </section>
  );
}

function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="ops-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index}>
          <span className="skeleton skeleton-text" style={{ width: "55%" }} />
          <span className="skeleton skeleton-text" style={{ width: "18%" }} />
        </li>
      ))}
    </ul>
  );
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
