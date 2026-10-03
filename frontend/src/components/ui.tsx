import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type PropsWithChildren, type ReactNode, type SelectHTMLAttributes } from "react";

import { ArrowLeftIcon, CheckIcon, CloseIcon, UploadIcon } from "./icons";
import type { Navigate } from "./navigation-types";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function Button({ children, className = "", ...props }, ref) {
    return (
      <button ref={ref} className={`button ${className}`.trim()} {...props}>
        {children}
      </button>
    );
  }
);

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="input" {...props} />;
}

export function IconButton({
  label,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={className} {...props}>
      {children}
    </button>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children
}: PropsWithChildren<{
  label: string;
  htmlFor: string;
  hint?: string;
}>) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function Alert({ children }: PropsWithChildren) {
  return (
    <div className="alert" role="alert">
      {children}
    </div>
  );
}

export function LoadingState({ label = "Working..." }: { label?: string }) {
  return (
    <span className="loading-state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}
    </span>
  );
}

export function Panel({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <section className={`panel${className ? ` ${className}` : ""}`}>{children}</section>;
}

/**
 * Contextual page intro for patient portal sections: breadcrumb, a short
 * mission line, plus an optional supporting image (from the approved
 * OncoEasy asset set). Purely presentational — introduces hierarchy without
 * inventing content.
 */
export function PageIntro({
  eyebrow,
  title,
  description,
  image,
  imageAlt = "",
  crumbs
}: {
  eyebrow: string;
  title: string;
  description: string;
  /** Optional approved asset path, e.g. /assets/hero/doctor-patient.webp. */
  image?: string;
  imageAlt?: string;
  /** Optional breadcrumb trail rendered above the eyebrow. */
  crumbs?: Array<{ label: string; href?: string }>;
}) {
  return (
    <section className={`page-intro${image ? " page-intro-with-media" : ""}`.trim()}>
      <div className="page-intro-text">
        {crumbs && crumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="breadcrumbs page-intro-crumbs">
            <ol>
              {crumbs.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`}>
                  {crumb.href ? (
                    <a href={crumb.href}>{crumb.label}</a>
                  ) : (
                    <span aria-current={index === crumbs.length - 1 ? "page" : undefined}>{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <p className="eyebrow teal-text">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-intro-description">{description}</p>
      </div>
      {image ? (
        <div className="page-intro-media">
          <img src={image} alt={imageAlt} width={640} height={427} loading="lazy" decoding="async" />
        </div>
      ) : null}
    </section>
  );
}

/**
 * Editorial card used in grid layouts (articles, stories, trials). Renders as
 * an <article> with an optional media slot; purely presentational, so the
 * whole card stays clickable only when callers provide their own button/link.
 */
export function EditorialCard({
  children,
  className = "",
  media,
  tone = "neutral"
}: PropsWithChildren<{
  className?: string;
  /** Optional media block rendered above the content. */
  media?: ReactNode;
  /** Accent tint for the icon tile / top edge. */
  tone?: "neutral" | "teal" | "blue" | "amber";
}>) {
  return (
    <article className={`editorial-card editorial-card-${tone}${className ? ` ${className}` : ""}`}>
      {media ? <div className="editorial-card-media">{media}</div> : null}
      <div className="editorial-card-body">{children}</div>
    </article>
  );
}

/** Small rounded icon tile used inside cards and empty states. */
export function IconTile({
  children,
  tone = "brand"
}: PropsWithChildren<{ tone?: "brand" | "teal" | "blue" | "amber" }>) {
  return <span className={`icon-tile icon-tile-${tone}`}>{children}</span>;
}

/**
 * Full-width list card (labs catalog, PAP programs): icon tile, title/description
 * block, and a right-aligned CTA that stays vertically centered at every width.
 */
export function ListCard({
  icon,
  tone = "brand",
  title,
  meta,
  children,
  action,
  className = ""
}: {
  icon?: ReactNode;
  tone?: "brand" | "teal" | "blue" | "amber";
  title: string;
  meta?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`list-card${className ? ` ${className}` : ""}`}>
      {icon ? (
        <span className={`icon-tile icon-tile-${tone}`} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="list-card-body">
        <h3>{title}</h3>
        {meta ? <span className="list-card-meta">{meta}</span> : null}
        {children ? <span className="list-card-children">{children}</span> : null}
      </div>
      {action ? <div className="list-card-action">{action}</div> : null}
    </div>
  );
}

/** Width-constrained page container used across the public site. */
export function Container({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <div className={`container ${className}`.trim()}>{children}</div>;
}

/** Consistent section intro: eyebrow, title, description, optional trailing action/link. */
export function SectionHeader({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div className="section-header-text">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export type BadgeTone = "neutral" | "brand" | "rx" | "cold" | "success";

const badgeToneClass: Record<BadgeTone, string> = {
  neutral: "",
  brand: "badge-brand",
  rx: "badge-rx",
  cold: "badge-cold",
  success: "badge-success"
};

export function Badge({ tone = "neutral", children }: PropsWithChildren<{ tone?: BadgeTone }>) {
  return <span className={`badge ${badgeToneClass[tone]}`.trim()}>{children}</span>;
}

/** Simple breadcrumb trail for future catalog/content pages. */
export function Breadcrumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {item.href ? <a href={item.href}>{item.label}</a> : <span aria-current="page">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function EmptyState({
  title,
  hint,
  icon,
  action
}: {
  title: string;
  hint?: string;
  /** Optional small icon above the title (from the shared icon set). */
  icon?: ReactNode;
  /** Optional contextual call to action, e.g. "Browse medicines". */
  action?: ReactNode;
}) {
  return (
    <div className="empty-state-block" role="status">
      {icon ? (
        <span className="empty-state-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className="empty-state-title">{title}</p>
      {hint ? <p className="empty-state-hint">{hint}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry, retryLabel = "Try again" }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className="error-state" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <Button className="button-secondary" type="button" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * One shared page-top row used on every workspace page: the BackLink on the
 * left, optional breadcrumbs beside it, and secondary actions (Sign out) on
 * the right. Keeps Back-button position, height, and typography identical
 * across all pages.
 */
export function PageTopRow({
  navigate,
  fallback,
  backLabel = "Back to dashboard",
  crumbs,
  children
}: {
  navigate: Navigate;
  fallback?: string;
  backLabel?: string;
  crumbs?: Array<{ label: string; href?: string }>;
  children?: ReactNode;
}) {
  return (
    <div className="page-top-row">
      <div className="page-top-row-left">
        <BackLink navigate={navigate} fallback={fallback} label={backLabel} />
        {crumbs && crumbs.length > 0 ? <Breadcrumbs items={crumbs} /> : null}
      </div>
      {children ? <div className="page-top-row-right">{children}</div> : null}
    </div>
  );
}

/**
 * Consistent back control for internal/detail pages. Returns to the previous
 * meaningful in-app location: browser history when the user navigated here
 * from inside the app, otherwise the page's natural home route. Never breaks
 * browser back/forward — history.back() is the same gesture as the browser's
 * own back button, and the fallback covers direct loads/deep links.
 */
export function BackLink({
  navigate,
  fallback,
  label = "Back"
}: {
  navigate: Navigate;
  /** Route used when there is no in-app history (direct load / deep link). */
  fallback?: string;
  /** Contextual label, e.g. "Back to Pharmacy". */
  label?: string;
}) {
  function handleClick(): void {
    // Same-origin app navigation is the only history we create; if the user
    // arrived from another site or a fresh tab load, history.length is small
    // and the fallback route is the honest destination.
    if (window.history.length > 1 && window.history.state?.idx > 0) {
      window.history.back();
      return;
    }
    if (fallback) navigate(fallback);
  }

  return (
    <button type="button" className="back-link" onClick={handleClick}>
      <ArrowLeftIcon size={16} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

/**
 * Accessible side drawer: scroll lock, Escape to close, click-outside overlay,
 * and focus moved into the panel on open. Focus returns to the previously
 * focused element on close when possible.
 */
export function Drawer({
  open,
  onClose,
  label,
  className,
  children
}: PropsWithChildren<{ open: boolean; onClose: () => void; label: string; className?: string }>) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add("drawer-open");
    panelRef.current?.focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove("drawer-open");
      restoreFocusRef.current?.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button type="button" className="drawer-overlay" aria-label="Close navigation" onClick={onClose} />
      <div ref={panelRef} className={className ? `drawer ${className}` : "drawer"} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </>
  );
}

/**
 * Phase 6.10 — Production-grade PageHero component.
 * Replaces monotonous header intros with rich, purpose-built hero sections.
 */
export function PageHero({
  eyebrow,
  title,
  highlight,
  description,
  image,
  imageAlt = "",
  badge,
  action,
  secondaryAction,
  tone = "teal",
  crumbs,
  className = ""
}: {
  eyebrow?: string;
  title: string;
  highlight?: string;
  description?: string;
  image?: string;
  imageAlt?: string;
  badge?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  tone?: "teal" | "blue" | "lavender" | "cream" | "brand";
  crumbs?: Array<{ label: string; href?: string }>;
  className?: string;
}) {
  return (
    <section className={`page-hero page-hero-${tone}${image ? " page-hero-split" : ""}${className ? ` ${className}` : ""}`.trim()}>
      <div className="page-hero-copy">
        {crumbs && crumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="breadcrumbs page-hero-crumbs">
            <ol>
              {crumbs.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`}>
                  {crumb.href ? (
                    <a href={crumb.href}>{crumb.label}</a>
                  ) : (
                    <span aria-current={index === crumbs.length - 1 ? "page" : undefined}>{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        {eyebrow ? (
          <div className="page-hero-kicker">
            <span className="kicker-line" aria-hidden="true" />
            {eyebrow}
          </div>
        ) : null}

        <h1>
          {title}
          {highlight ? <> <em>{highlight}</em></> : null}
        </h1>

        {description ? <p className="page-hero-description">{description}</p> : null}

        {action || secondaryAction ? (
          <div className="page-hero-actions">
            {action}
            {secondaryAction}
          </div>
        ) : null}
      </div>

      {image ? (
        <div className="page-hero-visual">
          <div className="page-hero-frame">
            {badge ? <span className="page-hero-badge">{badge}</span> : null}
            <img src={image} alt={imageAlt} width={560} height={380} loading="eager" decoding="async" />
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Phase 6.10 — Interactive feature selection / presentation card.
 */
export function FeatureCard({
  icon,
  tone = "teal",
  title,
  subtitle,
  description,
  badge,
  action,
  selected = false,
  onClick,
  className = ""
}: {
  icon?: ReactNode;
  tone?: "teal" | "blue" | "amber" | "brand";
  title: string;
  subtitle?: string;
  description?: string;
  badge?: ReactNode;
  action?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const Component = onClick ? "button" : "div";
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`feature-card feature-card-${tone}${selected ? " is-selected" : ""}${onClick ? " is-interactive" : ""}${className ? ` ${className}` : ""}`.trim()}
    >
      <div className="feature-card-header">
        {icon ? <span className={`feature-card-icon icon-tile-${tone}`}>{icon}</span> : null}
        {badge ? <div className="feature-card-badge-wrap">{badge}</div> : null}
      </div>
      <div className="feature-card-content">
        <h3>{title}</h3>
        {subtitle ? <p className="feature-card-subtitle">{subtitle}</p> : null}
        {description ? <p className="feature-card-desc">{description}</p> : null}
      </div>
      {action ? <div className="feature-card-action">{action}</div> : null}
    </Component>
  );
}

/**
 * Phase 6.10 — Interactive, high-clarity file upload area.
 */
export function UploadZone({
  id,
  label,
  hint,
  accept,
  file,
  onChange,
  required = false,
  disabled = false
}: {
  id: string;
  label: string;
  hint?: string;
  accept?: string;
  file: File | null;
  onChange: (file: File | null) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className={`upload-zone${file ? " has-file" : ""}${disabled ? " is-disabled" : ""}`}>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        required={required}
        disabled={disabled}
        className="upload-zone-input"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      <div className="upload-zone-droparea" onClick={() => inputRef.current?.click()}>
        <div className="upload-zone-icon" aria-hidden="true">
          {file ? <CheckIcon size={22} /> : <UploadIcon size={22} />}
        </div>
        <div className="upload-zone-text">
          <strong className="upload-zone-title">{file ? file.name : label}</strong>
          <span className="upload-zone-hint">
            {file ? `${(file.size / 1024).toFixed(1)} KB — click to replace` : hint ?? "Click to browse or drop document here"}
          </span>
        </div>
        {file ? (
          <button
            type="button"
            className="upload-zone-remove"
            aria-label="Remove selected file"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            <CloseIcon size={16} />
          </button>
        ) : (
          <span className="upload-zone-cta">Select file</span>
        )}
      </div>
    </div>
  );
}

/**
 * Phase 6.10 — Styled conversation message bubble.
 */
export function ChatBubble({
  sender,
  senderLabel,
  text,
  time,
  className = ""
}: {
  sender: "patient" | "support" | "system";
  senderLabel?: string;
  text: string;
  time?: string;
  className?: string;
}) {
  return (
    <div className={`chat-bubble chat-bubble-${sender}${className ? ` ${className}` : ""}`.trim()}>
      <div className="chat-bubble-meta">
        <span className="chat-bubble-sender">{senderLabel ?? (sender === "patient" ? "You" : sender === "support" ? "OncoCare Desk" : "System")}</span>
        {time ? <span className="chat-bubble-time">{time}</span> : null}
      </div>
      <p className="chat-bubble-text">{text}</p>
    </div>
  );
}
