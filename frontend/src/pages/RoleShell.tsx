import { useAuth } from "../auth/AuthContext";
import type { UserRole } from "../auth/types";
import { Button, Panel } from "../components/ui";
import { PatientDashboardPage } from "./PatientDashboardPage";

type Navigate = (path: string) => void;

const roleDetails: Record<UserRole, { title: string; description: string }> = {
  PATIENT: {
    title: "Patient workspace",
    description: "Your care journey will appear here as the next modules are connected."
  },
  DOCTOR: {
    title: "Doctor portal",
    description: "Clinical workspace modules will appear here in the next phase."
  },
  PHARMACIST: {
    title: "Pharmacist portal",
    description: "Pharmacy workspace modules will appear here in the next phase."
  },
  OPS_ADMIN: {
    title: "Operations admin",
    description: "Operations tools will appear here as they are implemented."
  },
  DELIVERY_AGENT: {
    title: "Delivery agent portal",
    description: "Assigned local deliveries and delivery proof actions."
  }
};

export function RoleShell({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  if (!user) {
    return null;
  }

  if (user.role === "PATIENT") {
    return <PatientDashboardPage navigate={navigate} />;
  }

  const details = roleDetails[user.role];

  function handleSignOut(): void {
    signOut();
    navigate("/");
  }

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">OncoEasy</p>
          <h1>{details.title}</h1>
        </div>
        <Button className="button-secondary" type="button" onClick={handleSignOut}>
          Sign out
        </Button>
      </header>
      <Panel>
        <p className="role-badge">{user.role}</p>
        <h2>Authentication complete</h2>
        <p>{details.description}</p>
        <p className="muted">Signed in as {user.email ?? user.phone ?? user.fullName ?? "OncoEasy user"}.</p>
        {user.role === "DOCTOR" ? (
          <div className="button-row">
            <Button type="button" onClick={() => navigate("/doctor/referrals")}>Open medicine referrals</Button>
            <Button className="button-secondary" type="button" onClick={() => navigate("/doctor/consultations")}>Open consultations</Button>
          </div>
        ) : null}
        {user.role === "OPS_ADMIN" ? (
          <div className="button-row">
            <Button type="button" onClick={() => navigate("/admin")}>Open operations overview</Button>
            <Button type="button" onClick={() => navigate("/admin/labs")}>Open lab bookings</Button>
            <Button className="button-secondary" type="button" onClick={() => navigate("/admin/pap")}>Open PAP Navigator</Button>
            <Button className="button-secondary" type="button" onClick={() => navigate("/admin/journey")}>Open journey stages</Button>
            <Button className="button-secondary" type="button" onClick={() => navigate("/admin/knowledge")}>Open knowledge articles</Button>
            <Button className="button-secondary" type="button" onClick={() => navigate("/admin/trials")}>Open clinical trials</Button>
            <Button className="button-secondary" type="button" onClick={() => navigate("/admin/stories")}>Open patient stories</Button>
            <Button className="button-secondary" type="button" onClick={() => navigate("/admin/chat")}>Open chat escalations</Button>
            <Button className="button-secondary" type="button" onClick={() => navigate("/admin/referrals")}>Open referral operations</Button>
            <Button className="button-secondary" type="button" onClick={() => navigate("/admin/consultations")}>Open consultation operations</Button>
            <Button className="button-secondary" type="button" onClick={() => navigate("/admin/analytics")}>Open analytics</Button>
          </div>
        ) : null}
      </Panel>
    </main>
  );
}
