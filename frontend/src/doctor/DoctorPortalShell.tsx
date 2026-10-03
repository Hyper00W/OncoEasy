import type { ReactNode } from "react";

import { PortalTopBar } from "../components/PortalTopBar";
import type { Navigate } from "../components/navigation-types";
import { DOCTOR_NAV_SECTIONS } from "./doctor-nav";

/**
 * Wraps a doctor workspace page with the shared professional top bar so all
 * doctor screens share brand, navigation, account menu, and mobile nav.
 */
export function DoctorPortalShell({
  navigate,
  activePath,
  children
}: {
  navigate: Navigate;
  activePath: string;
  children: ReactNode;
}) {
  return (
    <div className="portal-page">
      <PortalTopBar navigate={navigate} activePath={activePath} homePath="/doctor" sections={DOCTOR_NAV_SECTIONS} />
      <main className="portal-main">{children}</main>
    </div>
  );
}
