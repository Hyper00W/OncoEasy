import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { getPatientDashboard } from "../dashboard/dashboard-api";
import type { PatientDashboard } from "../dashboard/dashboard-api";
import { Alert, Button, LoadingState, Panel } from "../components/ui";

type Navigate = (path: string) => void;

type DashboardCardProps = {
  title: string;
  children: React.ReactNode;
};

export function PatientDashboardPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [dashboard, setDashboard] = useState<PatientDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    getPatientDashboard()
      .then((response) => {
        if (!cancelled) {
          setDashboard(response);
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(getDashboardErrorMessage(requestError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function handleSignOut(): void {
    signOut();
    navigate("/");
  }

  if (!dashboard && !error) {
    return (
      <main className="workspace-page dashboard-page">
        <LoadingState label="Loading your dashboard..." />
      </main>
    );
  }

  return (
    <main className="workspace-page dashboard-page">
      <header className="workspace-header dashboard-header">
        <div>
          <p className="eyebrow">OncoEasy patient workspace</p>
          <h1>Welcome{user?.fullName ? `, ${user.fullName}` : ""}</h1>
          <p className="dashboard-intro">Your care workspace, in one place.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={handleSignOut}>
          Sign out
        </Button>
      </header>

      {error ? (
        <>
          <Alert>{error}</Alert>
          <Button type="button" onClick={() => { setError(null); setReloadToken((current) => current + 1); }}>
            Retry
          </Button>
        </>
      ) : null}
      {user ? (
        <section className="dashboard-profile" aria-label="Patient information">
          <p className="eyebrow">Patient information</p>
          <p className="dashboard-value">{user.fullName ?? "Patient"}</p>
          {user.phone ? <p className="muted">{user.phone}</p> : null}
        </section>
      ) : null}
      {dashboard ? <DashboardContent dashboard={dashboard} navigate={navigate} /> : null}
    </main>
  );
}

function DashboardContent({
  dashboard,
  navigate
}: {
  dashboard: PatientDashboard;
  navigate: Navigate;
}) {
  return (
    <div className="dashboard-content">
      <div className="dashboard-grid">
        <DashboardCard title="Next step">
          {dashboard.nextStep ? (
            <>
              <p className="dashboard-value">{dashboard.nextStep.label}</p>
              <p className="muted">Your profile is ready for the next part of setup.</p>
            </>
          ) : (
            <EmptyState text="No next step available yet." />
          )}
        </DashboardCard>

        <DashboardCard title="Upcoming appointment">
          {dashboard.upcomingAppointment ? (
            <>
              <p className="dashboard-value">{formatDate(dashboard.upcomingAppointment.scheduledAt)}</p>
              <p className="muted">{dashboard.upcomingAppointment.doctor?.fullName ?? dashboard.upcomingAppointment.status}</p>
            </>
          ) : <EmptyState text="No upcoming appointments." />}
        </DashboardCard>

        <DashboardCard title="Active orders">
          {dashboard.activeOrders.length > 0 ? (
            <div className="stack-list">
              {dashboard.activeOrders.map((order) => <p className="list-row" key={order.id}><strong>{order.status}</strong>{order.totalAmount ? <span>{order.totalAmount}</span> : null}</p>)}
            </div>
          ) : <EmptyState text="No active orders." />}
        </DashboardCard>

        <DashboardCard title="Referral">
          {dashboard.referral ? <p className="dashboard-value">{dashboard.referral.status}</p> : <EmptyState text="No referral information yet." />}
        </DashboardCard>

        <DashboardCard title="Lab tests">
          {dashboard.labTests.length > 0 ? (
            <div className="stack-list">
              {dashboard.labTests.map((test, index) => <p className="list-row" key={test.bookingId ?? test.testId ?? index}><strong>{test.name ?? "Lab booking"}</strong>{test.status ? <span>{test.status}</span> : null}</p>)}
            </div>
          ) : <EmptyState text="No lab bookings yet." />}
        </DashboardCard>

        <DashboardCard title="PAP status">
          {dashboard.papStatus ? <p className="dashboard-value">{dashboard.papStatus.status}</p> : <EmptyState text="No PAP status available yet." />}
        </DashboardCard>
      </div>

      <section className="quick-links-section">
        <div>
          <p className="eyebrow">Explore your workspace</p>
          <h2>Quick links</h2>
        </div>
        <div className="quick-links-grid">
          {dashboard.quickLinks.map((link) => {
            const route = dashboardRoute(link.key);
            const canOpen = route !== null;
            return (
            <button
              className="quick-link"
              disabled={!canOpen}
              key={link.key}
              onClick={() => {
                if (route) navigate(route);
              }}
              type="button"
            >
              <span>{link.label}</span>
                <small>{canOpen ? "Open" : "Unavailable"}</small>
            </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function DashboardCard({ title, children }: DashboardCardProps) {
  return (
    <Panel>
      <h2>{title}</h2>
      {children}
    </Panel>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="empty-state">{text}</p>;
}

function getDashboardErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return "We could not load your dashboard. Please try again.";
}

function dashboardRoute(key: string): string | null {
  const routes: Record<string, string> = {
    pharmacy: "/patient/pharmacy",
    "doctor-consult": "/patient/consultations",
    "lab-tests": "/patient/labs",
    pap: "/patient/pap",
    "care-journey": "/patient/journey",
    "knowledge-bank": "/patient/knowledge",
    "patient-stories": "/patient/stories",
    chat: "/patient/chat"
  };
  return routes[key] ?? null;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
