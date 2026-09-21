import { useEffect, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import type { UserRole } from "../auth/types";
import {
  PatientPhonePage,
  PatientOtpPage,
  ProfessionalLoginPage,
  WelcomePage
} from "../pages/AuthPages";
import { PatientOnboardingPage } from "../pages/PatientOnboardingPage";
import { PharmacyPage } from "../pages/PharmacyPage";
import { DoctorReferralPage } from "../pages/DoctorReferralPage";
import { PatientReferralPage } from "../pages/PatientReferralPage";
import { PatientConsultationPage } from "../pages/PatientConsultationPage";
import { DoctorConsultationPage } from "../pages/DoctorConsultationPage";
import { PatientLabsPage } from "../pages/PatientLabsPage";
import { AdminLabsPage } from "../pages/AdminLabsPage";
import { PatientPAPPage } from "../pages/PatientPAPPage";
import { AdminPAPPage } from "../pages/AdminPAPPage";
import { PatientJourneyPage } from "../pages/PatientJourneyPage";
import { AdminJourneyPage } from "../pages/AdminJourneyPage";
import { PatientKnowledgePage } from "../pages/PatientKnowledgePage";
import { AdminKnowledgePage } from "../pages/AdminKnowledgePage";
import { PatientTrialsPage } from "../pages/PatientTrialsPage";
import { AdminTrialsPage } from "../pages/AdminTrialsPage";
import { PatientStoriesPage } from "../pages/PatientStoriesPage";
import { AdminStoriesPage } from "../pages/AdminStoriesPage";
import { PatientChatPage } from "../pages/PatientChatPage";
import { AdminChatPage } from "../pages/AdminChatPage";
import { AdminOverviewPage } from "../pages/AdminOverviewPage";
import { AdminReferralsPage } from "../pages/AdminReferralsPage";
import { AdminConsultationsPage } from "../pages/AdminConsultationsPage";
import { AdminAnalyticsPage } from "../pages/AdminAnalyticsPage";
import { RoleShell } from "../pages/RoleShell";

type Navigate = (path: string) => void;

type RouterState = {
  path: string;
  navigate: Navigate;
};

export function AppRouter() {
  const [path, setPath] = useState(() => window.location.pathname);

  function navigate(nextPath: string): void {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return <RouteView state={{ path, navigate }} />;
}

function RouteView({ state }: { state: RouterState }) {
  const { isAuthenticated, isReady, session, user } = useAuth();

  if (!isReady) {
    return <div className="route-loading">Checking your session...</div>;
  }

  if (isAuthenticated && user && isPublicPath(state.path)) {
    return (
      <Redirect
        path={pathForRole(user.role, session?.onboardingRequired)}
        navigate={state.navigate}
      />
    );
  }

  if (!isAuthenticated && isProtectedPath(state.path)) {
    return <Redirect path="/" navigate={state.navigate} />;
  }

  if (state.path === "/auth/patient/phone") {
    return <PatientPhonePage navigate={state.navigate} />;
  }

  if (state.path === "/auth/patient/otp") {
    return <PatientOtpPage navigate={state.navigate} />;
  }

  if (state.path === "/auth/professional") {
    return <ProfessionalLoginPage navigate={state.navigate} />;
  }

  if (isProtectedPath(state.path) && isAuthenticated && user) {
    const role = roleForPath(state.path);
    if (role !== user.role) {
      return <Redirect path={pathForRole(user.role)} navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && state.path === "/patient/onboarding") {
      if (!session?.onboardingRequired) {
        return <Redirect path="/patient" navigate={state.navigate} />;
      }

      return <PatientOnboardingPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && state.path === "/patient") {
      if (session?.onboardingRequired) {
        return <Redirect path="/patient/onboarding" navigate={state.navigate} />;
      }
    }

    if (user.role === "OPS_ADMIN" && state.path === "/admin") {
      return <AdminOverviewPage navigate={state.navigate} />;
    }

    if (isPharmacyPath(state.path)) {
      return <PharmacyPage navigate={state.navigate} />;
    }

    if (user.role === "DOCTOR" && state.path === "/doctor/referrals") {
      return <DoctorReferralPage navigate={state.navigate} />;
    }

    if (user.role === "DOCTOR" && state.path === "/doctor/consultations") {
      return <DoctorConsultationPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && state.path === "/patient/referral") {
      return <PatientReferralPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && state.path === "/patient/consultations") {
      return <PatientConsultationPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && state.path === "/patient/labs") {
      return <PatientLabsPage navigate={state.navigate} />;
    }

    if (user.role === "OPS_ADMIN" && state.path === "/admin/labs") {
      return <AdminLabsPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && state.path === "/patient/pap") {
      return <PatientPAPPage navigate={state.navigate} />;
    }

    if (user.role === "OPS_ADMIN" && state.path === "/admin/pap") {
      return <AdminPAPPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && state.path === "/patient/journey") {
      return <PatientJourneyPage navigate={state.navigate} />;
    }

    if (user.role === "OPS_ADMIN" && state.path === "/admin/journey") {
      return <AdminJourneyPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && state.path === "/patient/knowledge") {
      return <PatientKnowledgePage navigate={state.navigate} />;
    }

    if (user.role === "OPS_ADMIN" && state.path === "/admin/knowledge") {
      return <AdminKnowledgePage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && state.path === "/patient/stories") {
      return <PatientStoriesPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && state.path === "/patient/chat") {
      return <PatientChatPage navigate={state.navigate} />;
    }

    if (user.role === "OPS_ADMIN" && state.path === "/admin/stories") {
      return <AdminStoriesPage navigate={state.navigate} />;
    }

    if (user.role === "OPS_ADMIN" && state.path === "/admin/chat") {
      return <AdminChatPage navigate={state.navigate} />;
    }

    if (user.role === "OPS_ADMIN" && state.path === "/admin/referrals") {
      return <AdminReferralsPage navigate={state.navigate} />;
    }

    if (user.role === "OPS_ADMIN" && state.path === "/admin/consultations") {
      return <AdminConsultationsPage navigate={state.navigate} />;
    }

    if (user.role === "OPS_ADMIN" && state.path === "/admin/analytics") {
      return <AdminAnalyticsPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && state.path === "/patient/trials") {
      return <PatientTrialsPage navigate={state.navigate} />;
    }

    if (user.role === "OPS_ADMIN" && state.path === "/admin/trials") {
      return <AdminTrialsPage navigate={state.navigate} />;
    }

    return <RoleShell navigate={state.navigate} />;
  }

  return <WelcomePage navigate={state.navigate} />;
}

function Redirect({ path, navigate }: { path: string; navigate: Navigate }) {
  useEffect(() => navigate(path), [navigate, path]);
  return <div className="route-loading">Loading your workspace...</div>;
}

function isPublicPath(path: string): boolean {
  return path === "/" || path.startsWith("/auth/");
}

function isProtectedPath(path: string): boolean {
  return ["/patient", "/doctor", "/pharmacist", "/admin", "/delivery-agent"].some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

function roleForPath(path: string): UserRole | null {
  if (path.startsWith("/patient")) return "PATIENT";
  if (path.startsWith("/doctor")) return "DOCTOR";
  if (path.startsWith("/pharmacist")) return "PHARMACIST";
  if (path.startsWith("/admin")) return "OPS_ADMIN";
  if (path.startsWith("/delivery-agent")) return "DELIVERY_AGENT";
  return null;
}

function isPharmacyPath(path: string): boolean {
  return [
    "/patient/pharmacy",
    "/patient/orders",
    "/pharmacist",
    "/pharmacist/pharmacy",
    "/admin",
    "/admin/pharmacy",
    "/delivery-agent",
    "/delivery-agent/pharmacy"
  ].includes(path);
}

function pathForRole(role: UserRole, onboardingRequired = false): string {
  const paths: Record<UserRole, string> = {
    PATIENT: onboardingRequired ? "/patient/onboarding" : "/patient",
    DOCTOR: "/doctor",
    PHARMACIST: "/pharmacist",
    OPS_ADMIN: "/admin",
    DELIVERY_AGENT: "/delivery-agent/pharmacy"
  };

  return paths[role];
}
