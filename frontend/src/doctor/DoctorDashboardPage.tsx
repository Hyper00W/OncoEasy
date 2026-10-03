import { useEffect, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { Button } from "../components/ui";
import { StatusChip } from "../components/StatusChip";
import {
  ArrowRightIcon,
  ClipboardCheckIcon,
  PillIcon,
  StethoscopeIcon,
  UsersIcon
} from "../components/icons";
import type { Navigate } from "../components/navigation-types";
import { AdminTable, type AdminColumn } from "../components/admin/AdminTable";
import { ErrorState } from "../components/ui";
import { DoctorPortalShell } from "./DoctorPortalShell";
import {
  getErrorMessage,
  isActionRequiredAppointment,
  isReferralActive,
  isUpcomingAppointment,
  loadDoctorWorkspace,
  type Appointment,
  type Referral
} from "./doctor-dashboard";
import { formatDateTime, formatStatusLabel } from "../components/status-utils";

/**
 * Doctor clinical workspace. Everything shown is derived from the two
 * existing doctor endpoints (appointments + referrals). Counts appear only
 * when the data supports them; a new doctor sees calm empty states with the
 * one action they can take (publish availability or create a referral).
 */
export function DoctorDashboardPage({ navigate }: { navigate: Navigate }) {
  const { user } = useAuth();
  const [data, setData] = useState<{ appointments: Appointment[]; referrals: Referral[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadDoctorWorkspace()
      .then((workspace) => {
        if (!cancelled) {
          setData(workspace);
          setError(null);
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(getErrorMessage(requestError, "We could not load your workspace. Please try again."));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return (
    <DoctorPortalShell navigate={navigate} activePath="/doctor">
      {error && !data ? (
        <ErrorState message={error} onRetry={() => setReloadToken((token) => token + 1)} />
      ) : !data ? (
        <PortalSkeleton />
      ) : (
        <div className="portal-sections">
          <DocHero
            user={user}
            appointments={data.appointments}
            referrals={data.referrals}
            navigate={navigate}
          />

          <NextActionHero appointments={data.appointments} navigate={navigate} />

          <section className="ops-kpi-grid" aria-label="Practice summary">
            <DoctorKpi
              index={0}
              label="Awaiting confirmation"
              value={data.appointments.filter(isActionRequiredAppointment).length}
              hint="Patients waiting on your decision"
              icon={<StethoscopeIcon size={17} />}
              tone={data.appointments.filter(isActionRequiredAppointment).length > 0 ? "amber" : "indigo"}
              onClick={() => navigate("/doctor/consultations")}
              actionLabel="Review requests"
            />
            <DoctorKpi
              index={1}
              label="Upcoming appointments"
              value={data.appointments.filter(isUpcomingAppointment).length}
              hint="Confirmed and pending visits ahead"
              icon={<ClipboardCheckIcon size={17} />}
              onClick={() => navigate("/doctor/consultations")}
              actionLabel="Open schedule"
            />
            <DoctorKpi
              index={2}
              label="Referrals in flight"
              value={data.referrals.filter(isReferralActive).length}
              hint="Shared with patients, not yet ordered"
              icon={<UsersIcon size={17} />}
              tone="teal"
              onClick={() => navigate("/doctor/referrals")}
              actionLabel="Manage referrals"
            />
            <DoctorKpi
              index={3}
              label="Referrals ordered"
              value={data.referrals.filter((referral) => Boolean(referral.order)).length}
              hint="Referred medicines already ordered"
              icon={<PillIcon size={17} />}
              tone="teal"
              onClick={() => navigate("/doctor/referrals")}
              actionLabel="View orders"
            />
          </section>

          <div className="ops-zone-title">
            <h2>Referral workflow</h2>
          </div>
          <div className="doc-columns">
            <ReferralPipeline referrals={data.referrals} navigate={navigate} />
            <UpcomingSchedule appointments={data.appointments} navigate={navigate} />
          </div>

          <div className="ops-zone-title">
            <h2>Referral management</h2>
            <button className="link-button" type="button" onClick={() => navigate("/doctor/referrals")}>
              New referral →
            </button>
          </div>
          <ReferralTable referrals={data.referrals} navigate={navigate} />

          <ReferralInsight referrals={data.referrals} />
        </div>
      )}
    </DoctorPortalShell>
  );
}

/* -------------------------------------------------------------------------- */

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function DocHero({
  user,
  appointments,
  referrals,
  navigate
}: {
  user: { fullName?: string } | null;
  appointments: Appointment[];
  referrals: Referral[];
  navigate: Navigate;
}) {
  const fullName = user?.fullName ?? "";
  const lastName = fullName.split(" ").slice(1).join(" ") || fullName || "Doctor";
  const needsConfirmation = appointments.filter(isActionRequiredAppointment).length;
  const upcoming = appointments.filter(isUpcomingAppointment);
  const openReferrals = referrals.filter(isReferralActive).length;

  return (
    <section className="doc-hero" aria-label="Clinic overview">
      <div>
        <p className="portal-hero-eyebrow">Doctor referral &amp; patient care workspace</p>
        <h1>
          {greeting()}, Dr {lastName}.
        </h1>
        <p className="portal-hero-copy">{describeDay(appointments)}</p>
        <div className="doc-hero-meta">
          <span className={`doc-hero-chip${needsConfirmation > 0 ? " chip-attention" : ""}`}>
            <strong>{needsConfirmation}</strong> awaiting confirmation
          </span>
          <span className="doc-hero-chip">
            <strong>{upcoming.length}</strong> upcoming appointment{upcoming.length === 1 ? "" : "s"}
          </span>
          <span className="doc-hero-chip">
            <strong>{openReferrals}</strong> referral{openReferrals === 1 ? "" : "s"} in flight
          </span>
        </div>
      </div>
      <Button type="button" onClick={() => navigate("/doctor/referrals")}>
        New referral <ArrowRightIcon size={16} />
      </Button>
    </section>
  );
}

function describeDay(appointments: Appointment[]): string {
  const upcoming = appointments.filter(isUpcomingAppointment);
  const pending = appointments.filter(isActionRequiredAppointment);
  if (pending.length > 0) {
    return `${pending.length} appointment${pending.length === 1 ? "" : "s"} waiting for your confirmation.`;
  }
  if (upcoming.length > 0) {
    const next = upcoming[0];
    return `Next up: ${formatDateTime(next.scheduledAt)} (${formatStatusLabel(next.status)}).`;
  }
  return "No upcoming appointments. Publish availability so patients can book you.";
}

function NextActionHero({
  appointments,
  navigate
}: {
  appointments: Appointment[];
  navigate: Navigate;
}) {
  const pending = appointments.filter(isActionRequiredAppointment).slice(0, 1);
  if (pending.length === 0) return null;

  const appointment = pending[0];
  return (
    <section className="nextstep-hero nextstep-hero-action" aria-label="Action required">
      <div>
        <p className="eyebrow">Needs your confirmation</p>
        <h2>
          {appointment.patient.fullName} requested a{" "}
          {appointment.consultationType === "PHONE" ? "phone consultation" : "clinic visit"}
        </h2>
        <p>
          {formatDateTime(appointment.scheduledAt)} — confirm or cancel so the patient can plan.
        </p>
      </div>
      <Button type="button" onClick={() => navigate("/doctor/consultations")}>
        Review request <ArrowRightIcon size={16} />
      </Button>
    </section>
  );
}

function DoctorKpi({
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

/** Referral stages derived from the real status distribution — no invented numbers. */
function ReferralPipeline({
  referrals,
  navigate
}: {
  referrals: Referral[];
  navigate: Navigate;
}) {
  const stages = [
    {
      title: "Sent to patient",
      meta: "Referral shared, not yet opened",
      count: referrals.filter((referral) => referral.status === "SENT").length
    },
    {
      title: "Viewed",
      meta: "Patient has opened the referral",
      count: referrals.filter((referral) => referral.status === "VIEWED").length
    },
    {
      title: "Ordered",
      meta: "Medicines ordered from the pharmacy",
      count: referrals.filter((referral) => referral.status === "ORDERED").length
    },
    {
      title: "Fulfilled",
      meta: "Order delivered to the patient",
      count: referrals.filter((referral) => referral.status === "FULFILLED").length
    }
  ];

  return (
    <section className="ops-card" aria-label="Referral pipeline">
      <div className="ops-card-head">
        <h2>
          Referral pipeline
          <span className="ops-card-kicker">{referrals.length} total</span>
        </h2>
        <button className="link-button" type="button" onClick={() => navigate("/doctor/referrals")}>
          Open referrals
        </button>
      </div>
      {referrals.length === 0 ? (
        <div className="ops-empty">
          <p>You have not created any referrals yet. Refer medicines and patients order them directly from the pharmacy.</p>
          <button className="link-button" type="button" onClick={() => navigate("/doctor/referrals")}>
            Create your first referral
          </button>
        </div>
      ) : (
        <ul className="ops-list">
          {stages.map((stage) => (
            <li key={stage.title}>
              <span className="ops-list-title">
                {stage.title}
                <span className="ops-list-meta">{stage.meta}</span>
              </span>
              <span className="dash-count">{stage.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function UpcomingSchedule({
  appointments,
  navigate
}: {
  appointments: Appointment[];
  navigate: Navigate;
}) {
  const upcoming = appointments
    .filter(isUpcomingAppointment)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  return (
    <section className="ops-card" aria-label="Upcoming schedule">
      <div className="ops-card-head">
        <h2>Upcoming schedule</h2>
        <button className="link-button" type="button" onClick={() => navigate("/doctor/consultations")}>
          Calendar view
        </button>
      </div>
      {upcoming.length === 0 ? (
        <div className="ops-empty">
          <p>No booked appointments yet. Create availability slots so patients can find and book you.</p>
          <button className="link-button" type="button" onClick={() => navigate("/doctor/consultations")}>
            Publish availability
          </button>
        </div>
      ) : (
        <ul className="ops-list">
          {upcoming.slice(0, 5).map((appointment) => (
            <li key={appointment.appointmentId}>
              <span className="ops-list-title">
                {appointment.patient.fullName}
                <span className="ops-list-meta">
                  {formatDateTime(appointment.scheduledAt)} •{" "}
                  {appointment.consultationType === "PHONE" ? "Phone" : "In-clinic"}
                </span>
              </span>
              <StatusChip status={appointment.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReferralTable({
  referrals,
  navigate
}: {
  referrals: Referral[];
  navigate: Navigate;
}) {
  const columns: AdminColumn<Referral>[] = [
    {
      header: "Referral",
      cell: (referral) => (
        <div>
          <span className="mono">{referral.referralId.slice(0, 8)}</span>
          <span className="table-subtext">Created {formatDateTime(referral.createdAt)}</span>
        </div>
      )
    },
    {
      header: "Patient",
      cell: (referral) => referral.patient?.fullName ?? "—"
    },
    {
      header: "Medicines",
      cell: (referral) => (
        <div>
          <span>{referral.items.length}</span>
          <span className="table-subtext">
            {referral.items
              .slice(0, 2)
              .map((item) => item.name)
              .join(", ")}
            {referral.items.length > 2 ? ` +${referral.items.length - 2} more` : ""}
          </span>
        </div>
      )
    },
    { header: "Stage", cell: (referral) => <StatusChip status={referral.status} /> },
    {
      header: "Order",
      cell: (referral) =>
        referral.order ? (
          <div>
            <span className="mono">{referral.order.id.slice(0, 8)}</span>
            <span className="table-subtext">{formatStatusLabel(referral.order.status)}</span>
          </div>
        ) : (
          <span className="table-subtext">Not ordered yet</span>
        )
    },
    {
      header: "Actions",
      hideHeader: true,
      cell: () => (
        <button className="button button-link" type="button" onClick={() => navigate("/doctor/referrals")}>
          Details
        </button>
      )
    }
  ];

  return (
    <AdminTable
      columns={columns}
      rows={referrals}
      getKey={(referral) => referral.referralId}
      loading={false}
      loadingLabel="Loading referrals..."
      emptyTitle="No referrals yet"
      emptyHint="Create a referral and patients can order the medicines directly from the pharmacy."
    />
  );
}

/** Small supporting insight strip — computed from the referrals already loaded. */
function ReferralInsight({ referrals }: { referrals: Referral[] }) {
  if (referrals.length === 0) return null;
  const ordered = referrals.filter((referral) => referral.order).length;
  const conversion = Math.round((ordered / referrals.length) * 100);
  const totalItems = referrals.reduce((sum, referral) => sum + referral.items.length, 0);
  const avgItems = referrals.length > 0 ? (totalItems / referrals.length).toFixed(1) : "0";

  return (
    <section className="ops-card" aria-label="Referral insights">
      <div className="ops-card-head">
        <h2>Referral insights</h2>
      </div>
      <div className="doc-insight-row">
        <div>
          <span className="doc-insight-value">{conversion}%</span>
          <span className="doc-insight-label">of referrals converted to orders</span>
        </div>
        <div>
          <span className="doc-insight-value">{avgItems}</span>
          <span className="doc-insight-label">medicines per referral on average</span>
        </div>
        <div>
          <span className="doc-insight-value">{referrals.length}</span>
          <span className="doc-insight-label">referrals created in total</span>
        </div>
      </div>
    </section>
  );
}

function PortalSkeleton() {
  return (
    <div className="portal-sections" aria-hidden="true">
      <div className="skeleton skeleton-hero" />
      <div className="ops-kpi-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="ops-kpi" key={index}>
            <span className="skeleton skeleton-text" style={{ width: "40%" }} />
            <span className="skeleton skeleton-text" style={{ width: "55%", height: 28 }} />
            <span className="skeleton skeleton-text" style={{ width: "70%" }} />
          </div>
        ))}
      </div>
      <div className="doc-columns">
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
    </div>
  );
}
