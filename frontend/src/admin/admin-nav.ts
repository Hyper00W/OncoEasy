import type { ComponentType } from "react";

import {
  BookIcon,
  DocumentIcon,
  FlaskIcon,
  GridIcon,
  JourneyIcon,
  MessageCircleIcon,
  PillIcon,
  ShieldHeartIcon,
  StethoscopeIcon,
  TrendUpIcon,
  UsersIcon
} from "../components/icons";

export type AdminNavItem = {
  label: string;
  path: string;
  accent?: boolean;
  icon: ComponentType<{ size?: number }>;
};

export type AdminNavSection = {
  heading: string;
  items: AdminNavItem[];
};

/**
 * Admin/Ops navigation, grouped the way the operations desk thinks (overview →
 * care coordination → content → intelligence). Every item maps to a route with
 * real backend support; a "Patients / Users" section is intentionally absent
 * because the backend exposes no admin user-listing API — nothing is faked.
 */
export const ADMIN_NAV_SECTIONS: AdminNavSection[] = [
  {
    heading: "Overview",
    items: [
      { label: "Command center", path: "/admin", icon: GridIcon },
      { label: "Pharmacy & orders", path: "/admin/pharmacy", icon: PillIcon }
    ]
  },
  {
    heading: "Care coordination",
    items: [
      { label: "Referrals", path: "/admin/referrals", icon: DocumentIcon },
      { label: "Consultations", path: "/admin/consultations", icon: StethoscopeIcon },
      { label: "Labs & scans", path: "/admin/labs", icon: FlaskIcon },
      { label: "PAP Navigator", path: "/admin/pap", icon: ShieldHeartIcon }
    ]
  },
  {
    heading: "Content",
    items: [
      { label: "Care journey", path: "/admin/journey", icon: JourneyIcon },
      { label: "Knowledge", path: "/admin/knowledge", icon: BookIcon },
      { label: "Patient stories", path: "/admin/stories", icon: UsersIcon },
      { label: "Testimonials", path: "/admin/testimonials", icon: UsersIcon }
    ]
  },
  {
    heading: "Intelligence",
    items: [
      // Phase 8: the Demand Forecast Engine is a flagship workspace, not a
      // buried report — top of the intelligence group with an accent state.
      { label: "Demand forecast", path: "/admin/forecasts", accent: true, icon: TrendUpIcon },
      { label: "Analytics", path: "/admin/analytics", icon: GridIcon },
      { label: "Chat escalations", path: "/admin/chat", icon: MessageCircleIcon }
    ]
  }
];

/**
 * OWNER navigation (Phase 6.11): full-reach over the same real admin modules.
 * Kept separate so OWNER-specific labelling stays possible without diverging
 * structure. Trials live under Content for owners.
 */
export const MANAGEMENT_NAV_SECTIONS: AdminNavSection[] = [
  ADMIN_NAV_SECTIONS[0],
  ADMIN_NAV_SECTIONS[1],
  {
    heading: "Content",
    items: [
      { label: "Care journey", path: "/admin/journey", icon: JourneyIcon },
      { label: "Knowledge", path: "/admin/knowledge", icon: BookIcon },
      { label: "Clinical trials", path: "/admin/trials", icon: FlaskIcon },
      { label: "Patient stories", path: "/admin/stories", icon: UsersIcon },
      { label: "Testimonials", path: "/admin/testimonials", icon: UsersIcon }
    ]
  },
  ADMIN_NAV_SECTIONS[3]
];
