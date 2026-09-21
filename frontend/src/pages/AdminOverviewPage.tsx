import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  getAdminOverview,
  type AdminOverview
} from "../admin/admin-api";
import { Alert, Button, LoadingState } from "../components/ui";

type Navigate = (path: string) => void;

type OverviewCard = {
  label: string;
  value: number;
  route: string;
  description: string;
};

export function AdminOverviewPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function leave(): void {
    signOut();
    navigate("/");
  }

  function retry(): void {
    setError(null);
    setLoading(true);
    setReloadToken((current) => current + 1);
  }

  if (!user) return null;

  const cards: OverviewCard[] = overview
    ? [
      { label: "Pending prescription reviews", value: overview.pendingPrescriptionReviews, route: "/admin/pharmacy", description: "Pharmacist prescription queue" },
      { label: "Pending orders", value: overview.pendingOrders, route: "/admin/pharmacy", description: "Orders awaiting prescription, review, or payment" },
      { label: "Active deliveries", value: overview.activeDeliveries, route: "/admin/pharmacy", description: "Deliveries in progress" },
      { label: "Pending referrals", value: overview.pendingReferrals, route: "/admin/referrals", description: "Referrals sent or viewed, not yet ordered" },
      { label: "Upcoming consultations", value: overview.upcomingConsultations, route: "/admin/consultations", description: "Confirmed or pending future appointments" },
      { label: "Pending lab bookings", value: overview.pendingLabBookings, route: "/admin/labs", description: "Bookings awaiting operations" },
      { label: "PAP applications", value: overview.papApplicationsRequiringAttention, route: "/admin/pap", description: "Applications needing review or information" },
      { label: "Draft knowledge articles", value: overview.draftKnowledgeArticles, route: "/admin/knowledge", description: "Articles not yet published" },
      { label: "Unpublished clinical trials", value: overview.unpublishedClinicalTrials, route: "/admin/trials", description: "Trial records not yet published" },
      { label: "Stories awaiting review", value: overview.storiesAwaitingReview, route: "/admin/stories", description: "Patient stories under review" },
      { label: "Escalated chat sessions", value: overview.escalatedChatSessions, route: "/admin/chat", description: "Conversations flagged for human support" },
      { label: "Analytics", value: -1, route: "/admin/analytics", description: "Platform metrics and event log" }
    ]
    : [];

  return (
    <main className="workspace-page dashboard-page">
      <header className="workspace-header dashboard-header">
        <div>
          <p className="eyebrow">OncoEasy operations</p>
          <h1>Operations overview</h1>
          <p className="dashboard-intro">Pending work across all OncoEasy operations queues.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={leave}>Sign out</Button>
      </header>

      {error ? (
        <>
          <Alert>{error}</Alert>
          <Button type="button" onClick={retry}>Retry</Button>
        </>
      ) : null}

      {loading && !overview ? (
        <LoadingState label="Loading operations overview..." />
      ) : overview ? (
        <div className="dashboard-content">
          <div className="dashboard-grid">
            {cards.map((card) => (
              <button
                className="overview-card"
                key={card.label}
                type="button"
                onClick={() => navigate(card.route)}
              >
                <span className="overview-value">{card.value === -1 ? "→" : card.value}</span>
                <strong>{card.label}</strong>
                <small>{card.description}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The operations overview request could not be completed.";
}
