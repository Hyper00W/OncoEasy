import type { MouseEvent } from "react";

import { CartIcon, DocumentIcon, HomeIcon, LockIcon, UsersIcon } from "./icons";

type Navigate = (path: string) => void;

type FooterLink = { label: string; path: string };

type FooterColumn = { heading: string; links: FooterLink[] };

/** Footer navigation is built per render so the catalog link can carry the search. */
function footerColumns(catalogPath: string): FooterColumn[] {
  return [
  {
    heading: "Pharmacy",
    links: [
      { label: "Browse catalog", path: catalogPath },
      { label: "Your cart", path: "/patient/pharmacy?tab=cart" },
      { label: "Prescriptions", path: "/patient/pharmacy?tab=prescriptions" },
      { label: "Your orders", path: "/patient/pharmacy?tab=orders" }
    ]
  },
  {
    heading: "Care services",
    links: [
      { label: "Consult a doctor", path: "/patient/consultations" },
      { label: "Lab tests", path: "/patient/labs" },
      { label: "Patient assistance", path: "/patient/pap" },
      { label: "Care journey", path: "/patient/journey" }
    ]
  },
  {
    heading: "Community",
    links: [
      { label: "Knowledge bank", path: "/patient/knowledge" },
      { label: "Clinical trials", path: "/patient/trials" },
      { label: "Patient stories", path: "/patient/stories" },
      { label: "Testimonials", path: "/patient/testimonials" }
    ]
  },
    {
      heading: "Support",
      links: [
        { label: "Chat with our team", path: "/patient/chat" },
        { label: "Patient dashboard", path: "/patient" },
        { label: "Sign in", path: "/auth" }
      ]
    }
  ];
}

const FOOTER_ICONS = [CartIcon, DocumentIcon, UsersIcon, HomeIcon];

/**
 * Public footer. Links only to routes that exist; patient routes naturally
 * route anonymous visitors to sign-in via the router, and signed-in users
 * straight to their workspace.
 */
export function SiteFooter({
  navigate,
  searchQuery
}: {
  navigate: Navigate;
  /** Current medicine search, so "Browse catalog" continues an in-progress search. */
  searchQuery?: string;
}) {
  const catalogPath = searchQuery
    ? `/patient/pharmacy?search=${encodeURIComponent(searchQuery)}`
    : "/patient/pharmacy";

  function follow(event: MouseEvent<HTMLAnchorElement>, path: string): void {
    event.preventDefault();
    navigate(path);
  }

  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            {/* The footer band is deep navy, so it must use the light-on-dark
                lockup — the light-background variant is invisible here. */}
            <img
              className="footer-brand-logo"
              src="/assets/branding/oncoeasy-logo-dark.png"
              alt="OncoEasy"
              width={137}
              height={34}
              loading="lazy"
              decoding="async"
            />
            <p>
              Oncology-focused pharmacy and care coordination: medicines, doctor access, lab tests,
              and patient assistance, organised around your treatment.
            </p>
          </div>

          {footerColumns(catalogPath).map((column, index) => {
            const Icon = FOOTER_ICONS[index % FOOTER_ICONS.length];
            return (
              <nav aria-label={column.heading} key={column.heading}>
                <h3 className="footer-heading">
                  <Icon size={14} /> {column.heading}
                </h3>
                <ul className="footer-links">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <a href={link.path} onClick={(event) => follow(event, link.path)}>
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            );
          })}
        </div>

        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} OncoEasy. All rights reserved.</span>
          <span>
            <LockIcon size={13} /> Your prescriptions and medical data stay private.
          </span>
        </div>
      </div>
    </footer>
  );
}
