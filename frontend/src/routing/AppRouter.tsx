import { Suspense, lazy, useEffect, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import type { UserRole } from "../auth/types";
import {
  ManagementLoginPage,
  PatientPhonePage,
  PatientOtpPage,
  ProfessionalLoginPage,
  WelcomePage
} from "../pages/AuthPages";
import { HomePage } from "../pages/HomePage";
import { PharmacyCatalogPage } from "../pages/PharmacyCatalogPage";
import { ProductDetailPage } from "../pages/ProductDetailPage";
import { RoleShell } from "../pages/RoleShell";

/**
 * Phase 7 — route-level code splitting.
 *
 * The public entry surfaces (homepage, storefront, product detail, auth) stay
 * in the initial chunk so the first paint is never deferred. Every other
 * surface — the whole management console, the professional workspaces and the
 * secondary patient pages — loads on demand, which keeps the initial bundle
 * to the pages a first-time visitor actually needs.
 */
const PatientOnboardingPage = lazy(() =>
  import("../pages/PatientOnboardingPage").then((module) => ({ default: module.PatientOnboardingPage }))
);
const PharmacyPage = lazy(() =>
  import("../pages/PharmacyPage").then((module) => ({ default: module.PharmacyPage }))
);
const DoctorReferralPage = lazy(() =>
  import("../pages/DoctorReferralPage").then((module) => ({ default: module.DoctorReferralPage }))
);
const PatientReferralPage = lazy(() =>
  import("../pages/PatientReferralPage").then((module) => ({ default: module.PatientReferralPage }))
);
const PatientConsultationPage = lazy(() =>
  import("../pages/PatientConsultationPage").then((module) => ({ default: module.PatientConsultationPage }))
);
const DoctorConsultationPage = lazy(() =>
  import("../pages/DoctorConsultationPage").then((module) => ({ default: module.DoctorConsultationPage }))
);
const PatientLabsPage = lazy(() =>
  import("../pages/PatientLabsPage").then((module) => ({ default: module.PatientLabsPage }))
);
const AdminLabsPage = lazy(() =>
  import("../pages/AdminLabsPage").then((module) => ({ default: module.AdminLabsPage }))
);
const PatientPAPPage = lazy(() =>
  import("../pages/PatientPAPPage").then((module) => ({ default: module.PatientPAPPage }))
);
const AdminPAPPage = lazy(() =>
  import("../pages/AdminPAPPage").then((module) => ({ default: module.AdminPAPPage }))
);
const PatientJourneyPage = lazy(() =>
  import("../pages/PatientJourneyPage").then((module) => ({ default: module.PatientJourneyPage }))
);
const AdminJourneyPage = lazy(() =>
  import("../pages/AdminJourneyPage").then((module) => ({ default: module.AdminJourneyPage }))
);
const PatientKnowledgePage = lazy(() =>
  import("../pages/PatientKnowledgePage").then((module) => ({ default: module.PatientKnowledgePage }))
);
const AdminKnowledgePage = lazy(() =>
  import("../pages/AdminKnowledgePage").then((module) => ({ default: module.AdminKnowledgePage }))
);
const PatientTrialsPage = lazy(() =>
  import("../pages/PatientTrialsPage").then((module) => ({ default: module.PatientTrialsPage }))
);
const AdminTrialsPage = lazy(() =>
  import("../pages/AdminTrialsPage").then((module) => ({ default: module.AdminTrialsPage }))
);
const PatientStoriesPage = lazy(() =>
  import("../pages/PatientStoriesPage").then((module) => ({ default: module.PatientStoriesPage }))
);
const AdminStoriesPage = lazy(() =>
  import("../pages/AdminStoriesPage").then((module) => ({ default: module.AdminStoriesPage }))
);
const TestimonialsPage = lazy(() =>
  import("../pages/TestimonialsPage").then((module) => ({ default: module.TestimonialsPage }))
);
const AdminTestimonialsPage = lazy(() =>
  import("../pages/AdminTestimonialsPage").then((module) => ({ default: module.AdminTestimonialsPage }))
);
const PatientChatPage = lazy(() =>
  import("../pages/PatientChatPage").then((module) => ({ default: module.PatientChatPage }))
);
const AdminChatPage = lazy(() =>
  import("../pages/AdminChatPage").then((module) => ({ default: module.AdminChatPage }))
);
const AdminOverviewPage = lazy(() =>
  import("../pages/AdminOverviewPage").then((module) => ({ default: module.AdminOverviewPage }))
);
const AdminPharmacyPage = lazy(() =>
  import("../pages/AdminPharmacyPage").then((module) => ({ default: module.AdminPharmacyPage }))
);
const AdminReferralsPage = lazy(() =>
  import("../pages/AdminReferralsPage").then((module) => ({ default: module.AdminReferralsPage }))
);
const AdminConsultationsPage = lazy(() =>
  import("../pages/AdminConsultationsPage").then((module) => ({ default: module.AdminConsultationsPage }))
);
const AdminAnalyticsPage = lazy(() =>
  import("../pages/AdminAnalyticsPage").then((module) => ({ default: module.AdminAnalyticsPage }))
);
const AdminForecastPage = lazy(() =>
  import("../pages/AdminForecastPage").then((module) => ({ default: module.AdminForecastPage }))
);
const DoctorDashboardPage = lazy(() =>
  import("../doctor/DoctorDashboardPage").then((module) => ({ default: module.DoctorDashboardPage }))
);
const PharmacistDashboardPage = lazy(() =>
  import("../pharmacist/PharmacistDashboardPage").then((module) => ({ default: module.PharmacistDashboardPage }))
);

type Navigate = (path: string) => void;

type RouterState = {
  path: string;
  navigate: Navigate;
};

export function AppRouter() {
  // Full location (path + query) so query-only changes re-render views that
  // read filters from the URL, e.g. /pharmacy?search=... storefront states.
  const [location, setLocation] = useState(() => window.location.pathname + window.location.search);

  function navigate(nextPath: string): void {
    window.history.pushState({}, "", nextPath);
    setLocation(nextPath);
  }

  useEffect(() => {
    const handlePopState = () => setLocation(window.location.pathname + window.location.search);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Phase 6.8: keep the ambient page canvas in sync with the active route.
  useAmbientBackground(location);

  return <RouteView state={{ path: location, navigate }} />;
}

/**
 * The homepage, storefront, and auth screens have their own full-bleed
 * visuals. Workspace/portal routes get the ambient wash; the remaining public
 * pages get a lighter variant of the same wash so no page reads as a flat
 * empty field. Runs as an effect on every location change (cheap class toggle).
 */
function useAmbientBackground(location: string): void {
  useEffect(() => {
    const path = location.split("?")[0] ?? location;
    const hasOwnVisuals =
      path === "/" || path === "/pharmacy" || path.startsWith("/pharmacy/products") || path.startsWith("/auth");
    document.body.classList.toggle("has-ambient-bg", !hasOwnVisuals);
    document.body.classList.toggle("has-site-wash", hasOwnVisuals && path !== "/auth" && !path.startsWith("/auth"));
    return () => {
      document.body.classList.remove("has-ambient-bg");
      document.body.classList.remove("has-site-wash");
    };
  }, [location]);
}

/**
 * Suspense boundary for the lazily loaded workspaces. It sits inside the
 * router so every on-demand page shares one fallback, and the already-loaded
 * public routes never see a fallback at all.
 */
function RouteView({ state }: { state: RouterState }) {
  return (
    <Suspense fallback={<div className="route-loading">Opening your workspace...</div>}>
      <RouteContent state={state} />
    </Suspense>
  );
}

function RouteContent({ state }: { state: RouterState }) {
  const { isAuthenticated, isReady, session, user } = useAuth();

  // Routes match on the pathname only; query strings carry catalog state and
  // tab selections which the pages read from window.location themselves.
  const queryIndex = state.path.indexOf("?");
  const pathname = queryIndex === -1 ? state.path : state.path.slice(0, queryIndex);

  if (!isReady) {
    return <div className="route-loading">Checking your session...</div>;
  }

  // The homepage is public for everyone, signed in or not.
  if (pathname === "/") {
    return <HomePage navigate={state.navigate} />;
  }

  // Public pharmacy storefront (path or /products/:id detail) — browsable
  // without signing in; add-to-cart still requires the PATIENT role.
  if (pathname === "/pharmacy") {
    return <PharmacyCatalogPage navigate={state.navigate} />;
  }

  const storefrontProductMatch = STOREFRONT_PRODUCT_PATTERN.exec(pathname);
  if (storefrontProductMatch) {
    return <ProductDetailPage navigate={state.navigate} productId={storefrontProductMatch[1]} />;
  }

  if (isAuthenticated && user && isPublicPath(pathname)) {
    return (
      <Redirect
        path={pathForRole(user.role, session?.onboardingRequired)}
        navigate={state.navigate}
      />
    );
  }

  // Phase 6.11: management login lives behind the management URL and is
  // linked from nowhere on the public site. Already-authenticated management
  // sessions skip straight to the dashboard; other roles cannot use it.
  if (pathname === "/admin/login") {
    if (isAuthenticated && user && canAccessManagement(user.role)) {
      return <Redirect path="/admin" navigate={state.navigate} />;
    }
    if (!isAuthenticated) {
      return <ManagementLoginPage navigate={state.navigate} />;
    }
    // Authenticated non-management role: fall through to the guard below.
  }

  if (!isAuthenticated && isProtectedPath(pathname)) {
    return <Redirect path="/auth" navigate={state.navigate} />;
  }

  // Phase 6.11: the management portal ("/admin") is a role-gated surface.
  // PATIENT/DOCTOR/PHARMACIST sessions are rejected here AND by the backend
  // requireRole middleware on every management API — this guard is UX only.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (isAuthenticated && user && !canAccessManagement(user.role)) {
      return <ManagementAccessDenied navigate={state.navigate} />;
    }
  }

  if (pathname === "/auth") {
    return <WelcomePage navigate={state.navigate} />;
  }

  if (pathname === "/auth/patient/phone") {
    return <PatientPhonePage navigate={state.navigate} />;
  }

  if (pathname === "/auth/patient/otp") {
    return <PatientOtpPage navigate={state.navigate} />;
  }

  if (pathname === "/auth/professional") {
    return <ProfessionalLoginPage navigate={state.navigate} />;
  }

  if (isProtectedPath(pathname) && isAuthenticated && user) {
    const role = roleForPath(pathname);
    // Management routes ("/admin*") admit both management roles; every other
    // prefix is single-role.
    const roleAllowed =
      role === user.role || (role === "OPS_ADMIN" && canAccessManagement(user.role));
    if (role && !roleAllowed) {
      return <Redirect path={pathForRole(user.role)} navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && pathname === "/patient/onboarding") {
      if (!session?.onboardingRequired) {
        return <Redirect path="/patient" navigate={state.navigate} />;
      }

      return <PatientOnboardingPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && pathname === "/patient") {
      if (session?.onboardingRequired) {
        return <Redirect path="/patient/onboarding" navigate={state.navigate} />;
      }
    }

    if (isManagementRoute(user.role) && pathname === "/admin") {
      return <AdminOverviewPage navigate={state.navigate} />;
    }

    // Admin pharmacy operations console must be matched before the shared
    // PharmacyPage route, which also claims "/admin/pharmacy" for legacy reasons.
    if (isManagementRoute(user.role) && pathname === "/admin/pharmacy") {
      return <AdminPharmacyPage navigate={state.navigate} />;
    }

    if (user.role === "DOCTOR" && pathname === "/doctor") {
      return <DoctorDashboardPage navigate={state.navigate} />;
    }

    if (user.role === "PHARMACIST" && pathname === "/pharmacist") {
      return <PharmacistDashboardPage navigate={state.navigate} />;
    }

    if (isPharmacyPath(pathname)) {
      return <PharmacyPage navigate={state.navigate} />;
    }

    if (user.role === "DOCTOR" && pathname === "/doctor/referrals") {
      return <DoctorReferralPage navigate={state.navigate} />;
    }

    if (user.role === "DOCTOR" && pathname === "/doctor/consultations") {
      return <DoctorConsultationPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && pathname === "/patient/referral") {
      return <PatientReferralPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && pathname === "/patient/consultations") {
      return <PatientConsultationPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && pathname === "/patient/labs") {
      return <PatientLabsPage navigate={state.navigate} />;
    }

    if (isManagementRoute(user.role) && pathname === "/admin/labs") {
      return <AdminLabsPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && pathname === "/patient/pap") {
      return <PatientPAPPage navigate={state.navigate} />;
    }

    if (isManagementRoute(user.role) && pathname === "/admin/pap") {
      return <AdminPAPPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && pathname === "/patient/journey") {
      return <PatientJourneyPage navigate={state.navigate} />;
    }

    if (isManagementRoute(user.role) && pathname === "/admin/journey") {
      return <AdminJourneyPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && pathname === "/patient/knowledge") {
      return <PatientKnowledgePage navigate={state.navigate} />;
    }

    if (isManagementRoute(user.role) && pathname === "/admin/knowledge") {
      return <AdminKnowledgePage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && pathname === "/patient/stories") {
      return <PatientStoriesPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && pathname === "/patient/testimonials") {
      return <TestimonialsPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && pathname === "/patient/chat") {
      return <PatientChatPage navigate={state.navigate} />;
    }

    if (isManagementRoute(user.role) && pathname === "/admin/stories") {
      return <AdminStoriesPage navigate={state.navigate} />;
    }

    if (isManagementRoute(user.role) && pathname === "/admin/testimonials") {
      return <AdminTestimonialsPage navigate={state.navigate} />;
    }

    if (isManagementRoute(user.role) && pathname === "/admin/chat") {
      return <AdminChatPage navigate={state.navigate} />;
    }

    if (isManagementRoute(user.role) && pathname === "/admin/referrals") {
      return <AdminReferralsPage navigate={state.navigate} />;
    }

    if (isManagementRoute(user.role) && pathname === "/admin/consultations") {
      return <AdminConsultationsPage navigate={state.navigate} />;
    }

    if (isManagementRoute(user.role) && pathname === "/admin/analytics") {
      return <AdminAnalyticsPage navigate={state.navigate} />;
    }

    if (isManagementRoute(user.role) && pathname === "/admin/forecasts") {
      return <AdminForecastPage navigate={state.navigate} />;
    }

    if (user.role === "PATIENT" && pathname === "/patient/trials") {
      return <PatientTrialsPage navigate={state.navigate} />;
    }

    if (isManagementRoute(user.role) && pathname === "/admin/trials") {
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
  // "/admin/login" is deliberately NOT public-marketing: an authenticated
  // management session hitting it should route to the dashboard, and the
  // guard order above handles it before this redirect applies.
  return path === "/" || path.startsWith("/auth/") || path === "/pharmacy" || STOREFRONT_PRODUCT_PATTERN.test(path);
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

/**
 * Phase 6.11: management portal access. OWNER (full control) and OPS_ADMIN
 * (existing operational access) only. Purely a frontend UX guard — the
 * backend requireRole middleware remains the real authorization boundary.
 */
function canAccessManagement(role: UserRole): boolean {
  return role === "OWNER" || role === "OPS_ADMIN";
}

/** Management routes (/admin*) render for both management roles. */
function isManagementRoute(role: UserRole): boolean {
  return canAccessManagement(role);
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

const STOREFRONT_PRODUCT_PATTERN = /^\/pharmacy\/products\/([0-9a-fA-F-]{36})$/;

function pathForRole(role: UserRole, onboardingRequired = false): string {
  const paths: Record<UserRole, string> = {
    PATIENT: onboardingRequired ? "/patient/onboarding" : "/patient",
    DOCTOR: "/doctor",
    PHARMACIST: "/pharmacist",
    OPS_ADMIN: "/admin",
    DELIVERY_AGENT: "/delivery-agent/pharmacy",
    OWNER: "/admin"
  };

  return paths[role];
}

/**
 * Phase 6.11: explicit rejection screen for non-management roles that reach
 * a management URL (e.g. a doctor deep-linking to /admin). Offers a path
 * back to the correct workspace instead of a blank redirect.
 */
function ManagementAccessDenied({ navigate }: { navigate: Navigate }) {
  const { signOut } = useAuth();
  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">OncoEasy Management</p>
          <h1>Access restricted</h1>
        </div>
      </header>
      <section className="panel">
        <p>
          This area is limited to authorized management accounts (owner and
          operations administration). Your account does not have management
          access.
        </p>
        <div className="button-row">
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
          <button className="button" type="button" onClick={() => navigate("/")}>
            Go to the public website
          </button>
        </div>
      </section>
    </main>
  );
}
