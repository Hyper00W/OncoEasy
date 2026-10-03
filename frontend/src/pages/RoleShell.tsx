import { useEffect } from "react";

import { useAuth } from "../auth/AuthContext";
import { PatientDashboardPage } from "./PatientDashboardPage";

type Navigate = (path: string) => void;

const ROLE_HOME: Partial<Record<string, string>> = {
  DOCTOR: "/doctor",
  PHARMACIST: "/pharmacist",
  OPS_ADMIN: "/admin",
  // OWNER shares the management console; without this entry an unknown
  // protected path under an OWNER session rendered a blank page.
  OWNER: "/admin"
};

/**
 * Router fallback for authenticated protected paths without a dedicated
 * route. Each role's primary workspace has real pages, so this redirects
 * unknown role sub-paths to the role home; the delivery agent keeps its
 * existing pharmacy workspace link.
 */
export function RoleShell({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();

  const homePath = user ? ROLE_HOME[user.role] : undefined;

  useEffect(() => {
    if (user && homePath) {
      navigate(homePath);
    }
  }, [user, homePath, navigate]);

  if (!user) {
    return null;
  }

  if (user.role === "PATIENT") {
    return <PatientDashboardPage navigate={navigate} />;
  }

  if (homePath) {
    return <div className="route-loading">Opening your workspace...</div>;
  }

  if (user.role === "DELIVERY_AGENT") {
    return (
      <main className="workspace-page">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">OncoEasy</p>
            <h1>Delivery agent portal</h1>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              signOut();
              navigate("/");
            }}
          >
            Sign out
          </button>
        </header>
        <section className="panel">
          <p>Assigned local deliveries and delivery proof actions live in the pharmacy workspace.</p>
          <div className="button-row">
            <button className="button" type="button" onClick={() => navigate("/delivery-agent/pharmacy")}>
              Open assigned deliveries
            </button>
          </div>
        </section>
      </main>
    );
  }

  // Last resort (unknown role/unmapped path): never a blank screen — explain
  // what happened and offer the way back.
  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">OncoEasy</p>
          <h1>This page isn’t part of your workspace</h1>
        </div>
      </header>
      <section className="panel">
        <p>
          The link may be outdated, or this page may not exist for your account. Head back to the
          homepage, or sign in with the account that has access.
        </p>
        <div className="button-row">
          <button className="button" type="button" onClick={() => navigate("/")}>
            Go to the homepage
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              signOut();
              navigate("/auth");
            }}
          >
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}
