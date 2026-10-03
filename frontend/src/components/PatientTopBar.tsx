import { useEffect, useRef, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import type { Navigate } from "./navigation-types";
import { MenuIcon, CloseIcon, UserIcon } from "./icons";

const PATIENT_NAV_SECTIONS = [
  { label: "Dashboard", path: "/patient" },
  { label: "Medicines", path: "/pharmacy" },
  { label: "Cart & orders", path: "/patient/pharmacy" },
  { label: "Consultations", path: "/patient/consultations" },
  { label: "Labs", path: "/patient/labs" },
  { label: "PAP", path: "/patient/pap" },
  { label: "Journey", path: "/patient/journey" },
  { label: "Knowledge", path: "/patient/knowledge" },
  { label: "Chat", path: "/patient/chat" }
];

/**
 * Patient workspace top bar: brand, primary sections (real routes only), an
 * account menu, and a mobile hamburger with an inline panel. Rendered above
 * page content on patient workspace pages so the workspace reads as one
 * product rather than a collection of separate screens.
 */
export function PatientTopBar({ navigate, activePath }: { navigate: Navigate; activePath?: string }) {
  const { user, signOut } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setAccountOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function go(path: string): void {
    setAccountOpen(false);
    setMobileOpen(false);
    navigate(path);
  }

  function handleSignOut(): void {
    setAccountOpen(false);
    setMobileOpen(false);
    signOut();
    navigate("/");
  }

  return (
    <div className="patient-topbar-wrap navbar-dark" ref={rootRef as React.RefObject<HTMLDivElement | null>}>
      <div className="patient-topbar">
        <a
          className="patient-topbar-brand"
          href="/patient"
          onClick={(event) => {
            event.preventDefault();
            go("/patient");
          }}
        >
          <img
            className="topbar-brand-logo"
            src="/assets/branding/oncoeasy-logo-light.png"
            alt="OncoEasy"
            width={129}
            height={32}
            loading="eager"
            decoding="async"
          />
        </a>

        <nav className="patient-topbar-nav" aria-label="Patient sections">
          {PATIENT_NAV_SECTIONS.map((section) => {
            const isActive = activePath === section.path;
            return (
              <a
                key={section.label}
                href={section.path}
                className={`patient-topbar-link${isActive ? " is-active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  go(section.path);
                }}
              >
                {section.label}
              </a>
            );
          })}
        </nav>

        <div className="patient-topbar-actions">
          <button
            className="header-icon-button"
            type="button"
            aria-label="Account menu"
            aria-expanded={accountOpen}
            aria-haspopup="true"
            onClick={() => setAccountOpen((open) => !open)}
          >
            <UserIcon />
          </button>
          <button
            className="header-icon-button patient-topbar-burger"
            type="button"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <CloseIcon /> : <MenuIcon />}
          </button>

          {accountOpen ? (
            <div className="patient-account-menu" role="menu" aria-label="Account">
              <p className="patient-account-name">{user?.fullName ?? "Your account"}</p>
              {user?.phone ? <p className="patient-account-phone">{user.phone}</p> : null}
              <button role="menuitem" type="button" onClick={() => go("/patient")}>
                Dashboard
              </button>
              <button role="menuitem" type="button" onClick={() => go("/patient/pharmacy?tab=orders")}>
                Your orders
              </button>
              <button role="menuitem" type="button" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {mobileOpen ? (
        <nav className="patient-topbar-mobile" aria-label="Patient sections">
          {PATIENT_NAV_SECTIONS.map((section) => (
            <a
              key={section.label}
              href={section.path}
              className={`patient-topbar-mobile-link${activePath === section.path ? " is-active" : ""}`}
              onClick={(event) => {
                event.preventDefault();
                go(section.path);
              }}
            >
              {section.label}
            </a>
          ))}
          <button type="button" className="patient-topbar-mobile-signout" onClick={handleSignOut}>
            Sign out
          </button>
        </nav>
      ) : null}
    </div>
  );
}
