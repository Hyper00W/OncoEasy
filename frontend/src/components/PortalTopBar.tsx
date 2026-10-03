import { useEffect, useRef, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import type { Navigate } from "./navigation-types";
import { CloseIcon, MenuIcon, UserIcon } from "./icons";

export type PortalNavItem = { label: string; path: string };

/**
 * Professional workspace top bar (Phase 6.4): brand, role-specific sections,
 * an account menu with sign-out, and a mobile hamburger panel. Rendered above
 * every doctor/pharmacist workspace page so each portal reads as one product.
 * Navigation only lists routes the current role can actually reach.
 *
 * Embedded hosts (e.g. the Phase 6.5 admin shell, which renders its own
 * drawer navigation) can pass showMobileNav={false} to hide the built-in
 * hamburger and mobile panel while keeping the account menu.
 */
export function PortalTopBar({
  navigate,
  activePath,
  homePath,
  sections,
  showMobileNav = true,
  showBrand = true
}: {
  navigate: Navigate;
  activePath?: string;
  homePath: string;
  sections: PortalNavItem[];
  showMobileNav?: boolean;
  /** Hosts that already carry the brand (e.g. the admin sidebar) hide the
      duplicate topbar lockup to keep one brand anchor per screen. */
  showBrand?: boolean;
}) {
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
    <div className="portal-topbar-wrap navbar-dark" ref={rootRef as React.RefObject<HTMLDivElement | null>}>
      <div className="portal-topbar">
        {showBrand ? (
          <a
            className="patient-topbar-brand"
            href={homePath}
            onClick={(event) => {
              event.preventDefault();
              go(homePath);
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
        ) : null}

        {sections.length > 0 ? (
          <nav className="patient-topbar-nav" aria-label="Workspace sections">
            {sections.map((section) => {
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
        ) : null}

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
          {showMobileNav ? (
            <button
              className="header-icon-button patient-topbar-burger"
              type="button"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((open) => !open)}
            >
              {mobileOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          ) : null}

          {accountOpen ? (
            <div className="patient-account-menu" role="menu" aria-label="Account">
              <p className="patient-account-name">{user?.fullName ?? "Your account"}</p>
              {user?.email ? <p className="patient-account-phone">{user.email}</p> : null}
              <p className="patient-account-phone">{roleLabel(user?.role)}</p>
              <button role="menuitem" type="button" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {showMobileNav && mobileOpen ? (
        <nav className="patient-topbar-mobile" aria-label="Workspace sections">
          {sections.map((section) => (
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

function roleLabel(role: string | undefined): string {
  switch (role) {
    case "DOCTOR":
      return "Doctor workspace";
    case "PHARMACIST":
      return "Pharmacist workspace";
    case "OPS_ADMIN":
      return "Operations admin";
    case "DELIVERY_AGENT":
      return "Delivery agent";
    default:
      return "OncoEasy user";
  }
}
