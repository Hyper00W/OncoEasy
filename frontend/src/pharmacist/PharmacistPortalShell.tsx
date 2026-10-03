import type { ReactNode } from "react";

import { PortalTopBar } from "../components/PortalTopBar";
import type { Navigate } from "../components/navigation-types";
import { PHARMACIST_NAV_SECTIONS } from "./pharmacist-nav";

/**
 * Wraps a pharmacist workspace page with the shared professional top bar so
 * all pharmacist screens share brand, navigation, account menu, and mobile nav.
 */
export function PharmacistPortalShell({
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
      <PortalTopBar navigate={navigate} activePath={activePath} homePath="/pharmacist" sections={PHARMACIST_NAV_SECTIONS} />
      <main className="portal-main">{children}</main>
    </div>
  );
}
