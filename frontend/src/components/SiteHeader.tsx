import { useEffect, useRef, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import type { UserRole } from "../auth/types";
import { Drawer } from "./ui";
import {
  ArrowRightIcon,
  BookIcon,
  CaretDownIcon,
  CartIcon,
  ChevronRightIcon,
  CloseIcon,
  FlaskIcon,
  JourneyIcon,
  LogoutIcon,
  MenuIcon,
  PillIcon,
  ShieldHeartIcon,
  StethoscopeIcon,
  SupportIcon,
  UploadIcon,
  UserIcon
} from "./icons";

type Navigate = (path: string) => void;

type NavLeaf = { label: string; description: string; path: string };
type NavItem = { label: string; path: string; children?: NavLeaf[] };

/**
 * Public navigation. Every entry maps to a route that exists in AppRouter —
 * nothing is invented. The pharmacy dropdown exposes only dimensions the
 * data model actually supports (all medicines, Rx, cold-chain, request a
 * medicine) — conditions/molecules are NOT in the schema and are not faked.
 */
const NAV_ITEMS: NavItem[] = [
  {
    label: "Buy Medicines",
    path: "/pharmacy",
    children: [
      { label: "All medicines", description: "Browse the full catalog", path: "/pharmacy" },
      {
        label: "Prescription medicines",
        description: "Rx items with pharmacist verification",
        path: "/pharmacy?prescriptionRequired=true"
      },
      {
        label: "Cold-chain medicines",
        description: "2–8°C products handled end to end",
        path: "/pharmacy?coldChainRequired=true"
      },
      {
        label: "Wellness & supplies",
        description: "Non-prescription care products",
        path: "/pharmacy?prescriptionRequired=false"
      }
    ]
  },
  {
    label: "Patient Assistance",
    path: "/patient/pap",
    children: [
      { label: "PAP programs", description: "See available support programs", path: "/patient/pap" },
      { label: "Apply for support", description: "Start a PAP application", path: "/patient/pap" }
    ]
  },
  {
    label: "Consultations",
    path: "/patient/consultations",
    children: [
      { label: "Book a doctor", description: "Pick an available slot", path: "/patient/consultations" },
      { label: "Your appointments", description: "Manage upcoming visits", path: "/patient/consultations" }
    ]
  },
  { label: "Labs & Scans", path: "/patient/labs" },
  { label: "Care Journey", path: "/patient/journey" },
  {
    label: "Knowledge",
    path: "/patient/knowledge",
    children: [
      { label: "Article library", description: "Diagnosis, treatment, research", path: "/patient/knowledge" },
      { label: "Clinical trials", description: "Published trial listings", path: "/patient/trials" },
      { label: "Patient stories", description: "Experiences from the community", path: "/patient/stories" }
    ]
  },
  { label: "Support", path: "/patient/chat" }
];

const DASHBOARD_PATHS: Record<UserRole, string> = {
  PATIENT: "/patient",
  DOCTOR: "/doctor",
  PHARMACIST: "/pharmacist",
  OPS_ADMIN: "/admin",
  DELIVERY_AGENT: "/delivery-agent/pharmacy",
  OWNER: "/admin"
};

const NAV_ICONS = [PillIcon, ShieldHeartIcon, StethoscopeIcon, FlaskIcon, JourneyIcon, BookIcon, SupportIcon];

export function SiteHeader({
  navigate,
  activePath
}: {
  navigate: Navigate;
  /** Current top-level active path for nav item highlighting */
  activePath?: string;
}) {
  const { isAuthenticated, user, signOut } = useAuth();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);

  // Close any open dropdown on outside pointer press.
  useEffect(() => {
    function handlePointerDown(event: PointerEvent): void {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  // Escape closes the open dropdown; Tab out of the nav closes it too.
  useEffect(() => {
    if (!openMenu) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setOpenMenu(null);
      navRef.current?.querySelector<HTMLButtonElement>("button[aria-expanded='true']")?.focus();
    }

    function handleFocusIn(event: FocusEvent): void {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("focusin", handleFocusIn);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("focusin", handleFocusIn);
    };
  }, [openMenu]);

  function go(path: string): void {
    setOpenMenu(null);
    setDrawerOpen(false);
    navigate(path);
  }

  function handleSignOut(): void {
    signOut();
    go("/");
  }

  const accountPath = user ? DASHBOARD_PATHS[user.role] : "/";

  return (
    <>
      {/* Trust ribbon: scrolls away; only the light bar below stays sticky. */}
      <div className="header-trust">
        <div className="container header-trust-inner">
          <p className="header-trust-note">
            <ShieldHeartIcon size={14} />
            <span>Trusted oncology care, delivered with compassion</span>
          </p>
          <a
            className="header-trust-cta"
            href="/patient/chat"
            onClick={(event) => {
              event.preventDefault();
              go("/patient/chat");
            }}
          >
            <span>Need help?</span>
            <strong>Talk to our care team</strong>
            <ChevronRightIcon size={13} />
          </a>
        </div>
      </div>

      <header className="site-header navbar-dark">
        <div className="site-header-top">
          <div className="container">
            <a
              className="site-brand"
              href="/"
              onClick={(event) => {
                event.preventDefault();
                go("/");
              }}
            >
              <img
                className="site-brand-logo"
                src="/assets/branding/oncoeasy-logo-light.png"
                alt="OncoEasy"
                width={145}
                height={36}
                loading="eager"
                decoding="async"
              />
            </a>

            <nav className="site-nav" aria-label="Primary" ref={navRef}>
              <ul className="site-nav-list">
                {NAV_ITEMS.map((item, index) => {
                  const Icon = NAV_ICONS[index % NAV_ICONS.length];
                  const hasChildren = Boolean(item.children?.length);
                  const isOpen = openMenu === item.label;
                  const isActive =
                    activePath === item.path ||
                    (item.path !== "/pharmacy" && Boolean(activePath?.startsWith(`${item.path}/`)));
                  return (
                    <li className="nav-dropdown" key={item.label}>
                      {hasChildren ? (
                        <button
                          className={`site-nav-link${isActive ? " is-active" : ""}`}
                          type="button"
                          aria-expanded={isOpen}
                          aria-haspopup="true"
                          onClick={() => setOpenMenu(isOpen ? null : item.label)}
                        >
                          {item.label}
                          <span className="site-nav-caret" aria-hidden="true">
                            <CaretDownIcon size={14} />
                          </span>
                        </button>
                      ) : (
                        <a
                          className={`site-nav-link${isActive ? " is-active" : ""}`}
                          href={item.path}
                          aria-current={isActive ? "page" : undefined}
                          onClick={(event) => {
                            event.preventDefault();
                            go(item.path);
                          }}
                        >
                          {item.label}
                        </a>
                      )}
                      {hasChildren && isOpen ? (
                        <ul className="nav-menu">
                          {item.children?.map((child) => (
                            <li key={child.label}>
                              <a
                                className="nav-menu-item"
                                href={child.path}
                                onClick={(event) => {
                                  event.preventDefault();
                                  go(child.path);
                                }}
                              >
                                <span className="nav-menu-icon" aria-hidden="true">
                                  <Icon size={18} />
                                </span>
                                <span>
                                  <span className="nav-menu-title">{child.label}</span>
                                  <span className="nav-menu-desc">{child.description}</span>
                                </span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="site-header-actions">
              {user ? (
                <>
                  <button
                    className="header-icon-button"
                    type="button"
                    aria-label="Upload prescription"
                    title="Upload prescription"
                    onClick={() => go("/patient/pharmacy?tab=prescriptions")}
                  >
                    <UploadIcon />
                  </button>
                  <button
                    className="header-icon-button"
                    type="button"
                    aria-label="Open your cart"
                    title="Your cart"
                    onClick={() => go("/patient/pharmacy?tab=cart")}
                  >
                    <CartIcon />
                  </button>
                  <button
                    className="header-icon-button"
                    type="button"
                    aria-label="Open your workspace"
                    title="Your workspace"
                    onClick={() => go(accountPath)}
                  >
                    <UserIcon />
                  </button>
                  <button
                    className="header-icon-button"
                    type="button"
                    aria-label="Log out"
                    title="Log out"
                    onClick={handleSignOut}
                  >
                    <LogoutIcon />
                  </button>
                </>
              ) : (
                <>
                  <button className="button header-signin" type="button" onClick={() => go("/auth")}>
                    <UserIcon size={16} /> Sign in
                  </button>
                  <a
                    className="header-bag"
                    href="/patient/pharmacy?tab=cart"
                    onClick={(event) => {
                      event.preventDefault();
                      go("/patient/pharmacy?tab=cart");
                    }}
                  >
                    <CartIcon size={17} />
                    <span>Bag</span>
                  </a>
                </>
              )}
              <button
                className="header-icon-button hamburger"
                type="button"
                aria-label="Open navigation menu"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
              >
                <MenuIcon />
              </button>
            </div>
          </div>
        </div>

        <MobileDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onNavigate={go}
          isAuthenticated={isAuthenticated}
          userName={user?.fullName ?? null}
          onSignOut={handleSignOut}
        />
      </header>
    </>
  );
}

function MobileDrawer({
  open,
  onClose,
  onNavigate,
  isAuthenticated,
  userName,
  onSignOut
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
  isAuthenticated: boolean;
  userName: string | null;
  onSignOut: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Drawer open={open} onClose={onClose} label="Site navigation">
      <div className="drawer-header">
        <img
          className="drawer-brand-logo"
          src="/assets/branding/oncoeasy-logo-light.png"
          alt="OncoEasy"
          width={129}
          height={32}
          loading="lazy"
          decoding="async"
        />
        <button className="drawer-close" type="button" aria-label="Close navigation" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <div className="drawer-body">
        {!isAuthenticated ? (
          <div className="drawer-account">
            <button className="button" type="button" onClick={() => onNavigate("/auth")}>
              Sign in to OncoEasy
            </button>
            <p className="footer-note">
              Patient sign-in uses your phone number. Professionals sign in with email.
            </p>
          </div>
        ) : (
          <div className="drawer-account">
            <p className="eyebrow">Welcome back</p>
            <p className="site-testimonial-name">{userName ?? "Your workspace"}</p>
          </div>
        )}

        <p className="drawer-section-label">Pharmacy</p>
        <div className="drawer-quick-links">
          <a
            className="drawer-link"
            href="/pharmacy"
            onClick={(event) => {
              event.preventDefault();
              onNavigate("/pharmacy");
            }}
          >
            <span className="drawer-icon" aria-hidden="true">
              <PillIcon size={18} />
            </span>
            Buy medicines
          </a>
          <a
            className="drawer-link"
            href="/patient/pharmacy?tab=prescriptions"
            onClick={(event) => {
              event.preventDefault();
              onNavigate("/patient/pharmacy?tab=prescriptions");
            }}
          >
            <span className="drawer-icon" aria-hidden="true">
              <UploadIcon size={18} />
            </span>
            Upload prescription
          </a>
          <a
            className="drawer-link"
            href="/patient/pharmacy?tab=cart"
            onClick={(event) => {
              event.preventDefault();
              onNavigate("/patient/pharmacy?tab=cart");
            }}
          >
            <span className="drawer-icon" aria-hidden="true">
              <CartIcon size={18} />
            </span>
            Your cart & orders
          </a>
        </div>

        <p className="drawer-section-label">Services</p>
        <div className="drawer-accordion">
          {NAV_ITEMS.map((item) => {
            const Icon = NAV_ICONS[NAV_ITEMS.indexOf(item) % NAV_ICONS.length];
            const hasChildren = Boolean(item.children?.length);
            const isOpen = expanded === item.label;
            return (
              <div key={item.label}>
                {hasChildren ? (
                  <button
                    className="drawer-accordion-trigger"
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setExpanded(isOpen ? null : item.label)}
                  >
                    <span className="drawer-icon" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    {item.label}
                    <span className="site-nav-caret" aria-hidden="true" style={{ transform: isOpen ? "rotate(180deg)" : undefined }}>
                      <CaretDownIcon size={14} />
                    </span>
                  </button>
                ) : (
                  <a
                    className="drawer-accordion-trigger"
                    href={item.path}
                    onClick={(event) => {
                      event.preventDefault();
                      onNavigate(item.path);
                    }}
                  >
                    <span className="drawer-icon" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    {item.label}
                  </a>
                )}
                {hasChildren && isOpen ? (
                  <div className="drawer-accordion-panel">
                    {item.children?.map((child) => (
                      <a
                        className="drawer-sublink"
                        key={child.label}
                        href={child.path}
                        onClick={(event) => {
                          event.preventDefault();
                          onNavigate(child.path);
                        }}
                      >
                        <ArrowRightIcon size={14} />
                        {child.label}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <p className="drawer-section-label">Community</p>
        <a
          className="drawer-link"
          href="/patient/testimonials"
          onClick={(event) => {
            event.preventDefault();
            onNavigate("/patient/testimonials");
          }}
        >
          <span className="drawer-icon" aria-hidden="true">
            <UserIcon size={18} />
          </span>
          Testimonials
        </a>
      </div>

      <div className="drawer-footer">
        {isAuthenticated ? (
          <button className="button button-secondary" type="button" onClick={onSignOut}>
            Sign out
          </button>
        ) : null}
      </div>
    </Drawer>
  );
}
