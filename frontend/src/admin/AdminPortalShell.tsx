import { useState, type ReactNode } from "react";

import { useAuth } from "../auth/AuthContext";
import { PortalTopBar } from "../components/PortalTopBar";
import { MenuIcon } from "../components/icons";
import type { Navigate } from "../components/navigation-types";
import { Drawer } from "../components/ui";
import { ADMIN_NAV_SECTIONS } from "./admin-nav";
import { MANAGEMENT_NAV_SECTIONS } from "./management-nav";

/**
 * Admin/Ops portal shell. Desktop: persistent navy sidebar with workflow-
 * grouped, icon-led navigation plus a compact white top bar. Tablet/mobile:
 * the sidebar collapses behind a hamburger drawer (the shared accessible
 * Drawer: Escape to close, body scroll lock, focus moved into the panel and
 * restored on close). Navigation marks the active route with aria-current,
 * and the top bar reuses the shared professional account menu so all portals
 * read as one product family.
 */
export function AdminPortalShell({
  navigate,
  activePath,
  title,
  actions,
  children
}: {
  navigate: Navigate;
  activePath: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { user } = useAuth();
  // Phase 6.11: OWNER gets the full-reach management navigation; OPS_ADMIN
  // keeps its existing operational navigation unchanged.
  const navSections = user?.role === "OWNER" ? MANAGEMENT_NAV_SECTIONS : ADMIN_NAV_SECTIONS;

  return (
    <div className="admin-shell">
      <AdminSidebar navigate={navigate} activePath={activePath} navSections={navSections} />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        label="Admin navigation"
        className="admin-drawer"
      >
        <div className="admin-drawer-header">
          <img
            className="drawer-brand-logo"
            src="/assets/branding/oncoeasy-logo-light.png"
            alt="OncoEasy Ops"
            width={129}
            height={32}
            loading="lazy"
            decoding="async"
          />
        </div>
        <nav className="admin-drawer-body" aria-label="Admin sections">
          {navSections.map((section) => (
            <AdminNavGroup
              key={section.heading}
              heading={section.heading}
              items={section.items}
              activePath={activePath}
              onNavigate={navigate}
              onNavigateComplete={() => setDrawerOpen(false)}
            />
          ))}
        </nav>
      </Drawer>

      <div className="admin-content">
        <header className="admin-topbar navbar-dark">
          <button
            className="header-icon-button admin-burger"
            type="button"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon />
          </button>
          <div className="admin-topbar-title">
            <p className="admin-topbar-eyebrow">OncoEasy operations</p>
            <h1>{title}</h1>
          </div>
          <div className="admin-topbar-actions">
            {actions}
            {/* showMobileNav={false}: the shell renders its own drawer + burger;
                the embedded bar only provides the account/sign-out menu. */}
            <PortalTopBar
              navigate={navigate}
              activePath={activePath}
              homePath="/admin"
              sections={[]}
              showMobileNav={false}
              showBrand={false}
            />
          </div>
        </header>
        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}

/**
 * Command-center hero: the branded band every admin page opens with. Kept as
 * a component so all admin pages carry one identical, intentional identity.
 */
export function AdminCommandHero({
  eyebrow = "OncoEasy Operations Command Center",
  title,
  children
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <section className="ops-command-hero" aria-label={eyebrow}>
      <p className="ops-hero-eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
    </section>
  );
}

function AdminSidebar({
  navigate,
  activePath,
  navSections
}: {
  navigate: Navigate;
  activePath: string;
  navSections: typeof ADMIN_NAV_SECTIONS;
}) {
  const { user, signOut } = useAuth();
  return (
    <aside className="admin-sidebar">
      <button
        className="admin-sidebar-brand"
        type="button"
        onClick={() => navigate("/admin")}
      >
        {/* Desk sidebar is deep navy (see workspaces.css); the drawer stays a
            light surface and keeps the light-background lockup. */}
        <img
          className="sidebar-brand-logo"
          src="/assets/branding/oncoeasy-logo-dark.png"
          alt="OncoEasy Ops"
          width={129}
          height={32}
          loading="lazy"
          decoding="async"
        />
      </button>
      <nav className="admin-sidebar-nav" aria-label="Admin sections">
        {navSections.map((section) => (
          <AdminNavGroup
            key={section.heading}
            heading={section.heading}
            items={section.items}
            activePath={activePath}
            onNavigate={navigate}
          />
        ))}
      </nav>
      <div className="admin-sidebar-footer">
        <p className="admin-sidebar-user">{user?.fullName ?? "Management"}</p>
        <p className="admin-sidebar-role">{user?.role ?? ""}</p>
        <button
          className="button button-secondary admin-signout"
          type="button"
          onClick={() => {
            signOut();
            navigate("/");
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

function AdminNavGroup({
  heading,
  items,
  activePath,
  onNavigate,
  onNavigateComplete
}: {
  heading: string;
  items: { label: string; path: string; accent?: boolean; icon: React.ComponentType<{ size?: number }> }[];
  activePath: string;
  onNavigate: Navigate;
  onNavigateComplete?: () => void;
}) {
  return (
    <div className="admin-nav-group">
      <p className="admin-nav-heading">{heading}</p>
      <ul className="admin-nav-list">
        {items.map((item) => {
          // The pharmacy section covers /admin/pharmacy paths.
          const isActive =
            activePath === item.path ||
            (item.path !== "/admin" && activePath.startsWith(`${item.path}/`));
          const Icon = item.icon;
          return (
            <li key={item.path}>
              <a
                href={item.path}
                className={`admin-nav-link${isActive ? " is-active" : ""}${item.accent ? " admin-nav-link-accent" : ""}`}
                aria-current={isActive ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(item.path);
                  onNavigateComplete?.();
                }}
              >
                <Icon size={16} />
                <span>{item.label}</span>
                {item.accent ? <span className="admin-nav-accent-dot" aria-hidden="true" /> : null}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
