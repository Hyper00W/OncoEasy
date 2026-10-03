import type { PropsWithChildren, ReactNode } from "react";

import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import type { Navigate } from "../components/navigation-types";

/**
 * Phase 6.10 — the canonical patient website shell.
 *
 * Every patient-facing page renders through this component so the whole
 * website shares a single persistent frame: identical canonical SiteHeader (with
 * interactive dropdowns, mobile drawer, search, and nav active state), one shared
 * page container (max-width, padding, BackLink row slot), and the same SiteFooter.
 */
export function PatientPageShell({
  navigate,
  activePath,
  backSlot,
  children,
  className = "",
  width = "wide"
}: PropsWithChildren<{
  navigate: Navigate;
  /** Current top-level path for nav highlighting, e.g. "/patient/consultations". */
  activePath?: string;
  /** Rendered above the page content — the BackLink row, aligned to the shared left edge. */
  backSlot?: ReactNode;
  /** Extra page-specific class appended to the page body (e.g. "labs-page"). */
  className?: string;
  /** "narrow" matches the dashboard's 1140px column; "wide" uses the 1240px site container. */
  width?: "narrow" | "wide";
}>) {
  return (
    <main className={`patient-shell patient-shell-${width}`}>
      <SiteHeader navigate={navigate} activePath={activePath} />
      <div className={`patient-shell-body${className ? ` ${className}` : ""}`}>
        {backSlot ? <div className="patient-shell-backrow">{backSlot}</div> : null}
        {children}
      </div>
      <SiteFooter navigate={navigate} />
    </main>
  );
}
