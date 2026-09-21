import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  analyticsEventNames,
  getAnalyticsOverview,
  listAnalyticsEvents,
  type AnalyticsEvent,
  type AnalyticsEventName,
  type AnalyticsOverview
} from "../analytics/analytics-api";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";

type Navigate = (path: string) => void;

const eventsPageSize = 20;

export function AdminAnalyticsPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: eventsPageSize, total: 0, totalPages: 1 });
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [range, setRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [eventNameFilter, setEventNameFilter] = useState<AnalyticsEventName | "">("");
  const [eventsQuery, setEventsQuery] = useState<{ page: number; eventName: AnalyticsEventName | "" }>({ page: 1, eventName: "" });
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getAnalyticsOverview({ from: range.from || undefined, to: range.to || undefined })
      .then((response) => {
        if (cancelled) return;
        setOverview(response);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [range]);

  useEffect(() => {
    let cancelled = false;

    listAnalyticsEvents({
      page: eventsQuery.page,
      pageSize: eventsPageSize,
      eventName: eventsQuery.eventName || undefined
    })
      .then((response) => {
        if (cancelled) return;
        setEvents(response.items);
        setPagination(response.pagination);
        setEventsError(null);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setEventsError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [eventsQuery]);

  function leave(): void {
    signOut();
    navigate("/");
  }

  function applyRange(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    setLoading(true);
    setRange({ from: toIso(fromInput, false), to: toIso(toInput, true) });
  }

  function clearRange(): void {
    setFromInput("");
    setToInput("");
    setError(null);
    setLoading(true);
    setRange({ from: "", to: "" });
  }

  function applyEventFilters(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setEventsError(null);
    setEventsLoading(true);
    setEventsQuery({ page: 1, eventName: eventNameFilter });
  }

  function retry(): void {
    setError(null);
    setLoading(true);
    setRange({ ...range });
    setEventsError(null);
    setEventsLoading(true);
    setEventsQuery({ ...eventsQuery });
  }

  if (!user) return null;

  return (
    <main className="workspace-page consultation-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Operations admin</p>
          <h1>Analytics</h1>
          <p className="intro">Platform metrics computed by the backend from referral, consultation, lab, PAP, pharmacy, and engagement activity.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={leave}>Sign out</Button>
      </header>

      {error ? (
        <>
          <Alert>{error}</Alert>
          <Button type="button" onClick={retry}>Retry</Button>
        </>
      ) : null}

      <Panel>
        <h2>Date range</h2>
        <form className="form-stack" onSubmit={applyRange}>
          <div className="analytics-range-row">
            <Field label="From" htmlFor="analytics-from" hint="Metrics created on or after this local date.">
              <Input id="analytics-from" type="date" value={fromInput} onChange={(event) => setFromInput(event.target.value)} />
            </Field>
            <Field label="To" htmlFor="analytics-to" hint="Metrics created on or before this local date.">
              <Input id="analytics-to" type="date" value={toInput} onChange={(event) => setToInput(event.target.value)} />
            </Field>
          </div>
          <div className="button-row">
            <Button type="submit">Apply range</Button>
            <Button className="button-secondary" type="button" onClick={clearRange}>Clear range</Button>
          </div>
        </form>
      </Panel>

      {loading && !overview ? (
        <LoadingState label="Loading analytics..." />
      ) : overview ? (
        <section className="consultation-grid">
          <Panel>
            <h2>Conversion metrics</h2>
            <div className="analytics-metric-grid">
              <MetricCard label="Referral conversion" value={formatRate(overview.referralConversion.rate)} detail={`${overview.referralConversion.converted} converted of ${overview.referralConversion.created} created`} />
              <MetricCard label="Lab conversion" value={formatRate(overview.labConversion.rate)} detail={`${overview.labConversion.completed} completed of ${overview.labConversion.bookings} bookings`} />
              <MetricCard label="PAP completion" value={formatRate(overview.papCompletion.rate)} detail={`${overview.papCompletion.completed} completed of ${overview.papCompletion.submitted} submitted`} />
              <MetricCard label="Prescription query rate" value={formatRate(overview.prescriptionQueryRate.rate)} detail={`${overview.prescriptionQueryRate.queried} queried of ${overview.prescriptionQueryRate.reviewed} reviewed`} />
            </div>
          </Panel>

          <Panel>
            <h2>Consultations and PAP</h2>
            <div className="analytics-metric-grid">
              <MetricCard label="In clinic" value={String(overview.consultationModeSplit.IN_CLINIC)} detail="Consultations booked in clinic" />
              <MetricCard label="Phone" value={String(overview.consultationModeSplit.PHONE)} detail="Consultations booked by phone" />
              <MetricCard label="Average PAP approval time" value={overview.papApprovalTime.averageHours === null ? "—" : `${overview.papApprovalTime.averageHours} h`} detail={`${overview.papApprovalTime.approvedApplications} approved application(s)`} />
            </div>
          </Panel>

          <Panel>
            <h2>Pharmacy, referrals, and journeys</h2>
            <div className="analytics-metric-grid">
              <MetricCard label="Completed pharmacy orders" value={String(overview.completedPharmacyOrders)} detail="Orders delivered" />
              <MetricCard label="Repeat pharmacy order patients" value={String(overview.repeatPharmacyOrders.patients)} detail="Patients with more than one delivered order" />
              <MetricCard label="Doctor re-referral pairs" value={String(overview.doctorReReferral.doctorPatientPairs)} detail="Doctor-patient pairs with more than one referral" />
              <MetricCard label="Journey returns" value={String(overview.journeyReturns.count)} detail="Journey stage returns" />
            </div>
          </Panel>

          <Panel>
            <h2>Content and engagement</h2>
            <div className="analytics-metric-grid">
              <MetricCard label="Knowledge article views" value={String(overview.knowledgeEngagement.articleViews)} detail="Article view events" />
              <MetricCard label="Clinical trial interests" value={String(overview.clinicalTrialInterests.submitted)} detail="Interest submissions" />
              <MetricCard label="Published patient stories" value={String(overview.patientStories.published)} detail="Approved and published stories" />
            </div>
          </Panel>
        </section>
      ) : null}

      <Panel>
        <h2>Analytics events</h2>
        <form className="form-stack" onSubmit={applyEventFilters}>
          <Field label="Event name" htmlFor="analytics-event-name">
            <select className="input" id="analytics-event-name" value={eventNameFilter} onChange={(event) => setEventNameFilter(event.target.value as AnalyticsEventName | "")}>
              <option value="">All events</option>
              {analyticsEventNames.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}
            </select>
          </Field>
          <Button type="submit">Apply filter</Button>
        </form>

        {eventsError ? (
          <>
            <Alert>{eventsError}</Alert>
            <Button type="button" onClick={retry}>Retry</Button>
          </>
        ) : null}

        {eventsLoading ? (
          <LoadingState label="Loading events..." />
        ) : events.length === 0 ? (
          <p className="empty-state">No analytics events match the current filter.</p>
        ) : (
          <div className="stack-list">
            {events.map((item) => (
              <div className="list-row" key={item.eventId}>
                <div>
                  <strong>{formatLabel(item.eventName)}</strong>
                  <span className="muted">{item.entityType}{item.entityId ? ` • ${item.entityId.slice(0, 8)}` : ""}{item.userId ? ` • User ${item.userId.slice(0, 8)}` : ""}</span>
                </div>
                <span className="status">{formatDate(item.createdAt)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="button-row">
          <Button className="button-secondary" type="button" disabled={eventsLoading || pagination.page <= 1} onClick={() => setEventsQuery({ ...eventsQuery, page: pagination.page - 1 })}>Previous</Button>
          <span className="field-hint">Page {pagination.page} of {Math.max(pagination.totalPages, 1)} • {pagination.total} event(s)</span>
          <Button className="button-secondary" type="button" disabled={eventsLoading || pagination.page >= pagination.totalPages} onClick={() => setEventsQuery({ ...eventsQuery, page: pagination.page + 1 })}>Next</Button>
        </div>
      </Panel>
    </main>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="overview-card">
      <span className="overview-value">{value}</span>
      <strong>{label}</strong>
      <small>{detail}</small>
    </div>
  );
}

function toIso(value: string, endOfDay: boolean): string {
  if (!value) return "";
  const date = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatLabel(value: string): string {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The analytics request could not be completed.";
}
