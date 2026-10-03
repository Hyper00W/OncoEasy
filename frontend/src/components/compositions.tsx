import type { PropsWithChildren, ReactNode } from "react";

import { STAGGER_STEP_MS } from "../motion/hooks";
import { Reveal } from "../motion/motion";
import { ArrowRightIcon } from "./icons";

/**
 * Phase 7 composition primitives.
 *
 * The patient website used to be assembled from one generic shape
 * (`PageIntro` + `Panel`), which made every page read the same. These
 * components are the vocabulary the redesign composes pages from, so a
 * homepage hero, a journey timeline, a labs feature and a dashboard metric
 * can all belong to the same design language without being the same layout.
 *
 * Every primitive is presentational only: it renders whatever content the
 * caller already fetched from the API and invents nothing.
 */

/* ---------------------------------------------------------------------------
   SectionShell — an editorial band with an optional tinted background
   ------------------------------------------------------------------------- */

export function SectionShell({
  id,
  tone = "plain",
  eyebrow,
  title,
  description,
  action,
  children,
  className = "",
  collapse = false
}: PropsWithChildren<{
  id?: string;
  /** Surface treatment for the band. */
  tone?: "plain" | "tint" | "sunken" | "brand" | "teal";
  eyebrow?: string;
  title?: string;
  description?: string;
  /** Optional trailing link/button aligned to the section head. */
  action?: ReactNode;
  className?: string;
  /** Removes the inner container padding (for full-bleed content). */
  collapse?: boolean;
}>) {
  const classes = ["section-shell", `section-shell-${tone}`, className].filter(Boolean).join(" ");

  return (
    <section id={id} className={classes}>
      <div className={collapse ? "" : "container"}>
        {eyebrow || title || description || action ? (
          <Reveal className="section-shell-head">
            <div className="section-shell-head-text">
              {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
              {title ? <h2>{title}</h2> : null}
              {description ? <p className="section-shell-description">{description}</p> : null}
            </div>
            {action ? <div className="section-shell-action">{action}</div> : null}
          </Reveal>
        ) : null}
        {children}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
   Metrics
   ------------------------------------------------------------------------- */

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "brand",
  trend,
  index = 0
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: "brand" | "teal" | "amber" | "blue" | "danger";
  /** Optional small delta line, e.g. "+12 this week". */
  trend?: ReactNode;
  /** Position in a grid, used for the entrance stagger. */
  index?: number;
}) {
  return (
    <Reveal
      as="article"
      className={`stat-card stat-card-${tone}`}
      delay={index * STAGGER_STEP_MS}
      aria-label={`${label}: ${typeof value === "string" ? value : ""}`}
    >
      <div className="stat-card-head">
        <p className="stat-card-label">{label}</p>
        {icon ? (
          <span className={`stat-card-icon icon-tile-${tone}`} aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>
      <p className="stat-card-value">{value}</p>
      {trend ? <p className="stat-card-trend">{trend}</p> : null}
      {hint ? <p className="stat-card-hint">{hint}</p> : null}
    </Reveal>
  );
}

export function MetricGrid({
  children,
  className = ""
}: PropsWithChildren<{ className?: string }>) {
  return <div className={`metric-grid stat-grid ${className}`.trim()}>{children}</div>;
}

/* ---------------------------------------------------------------------------
   ServiceCard — action tile used in dashboards and service sections
   ------------------------------------------------------------------------- */

export function ServiceCard({
  icon,
  tone = "brand",
  title,
  description,
  meta,
  badge,
  onClick,
  href,
  index = 0,
  emphasised = false
}: {
  icon?: ReactNode;
  tone?: "brand" | "teal" | "amber" | "blue";
  title: string;
  description?: string;
  meta?: string;
  badge?: ReactNode;
  /** Provide exactly one of onClick/href. */
  onClick?: () => void;
  href?: string;
  index?: number;
  /** Draws the eye to the single most important tile in a group. */
  emphasised?: boolean;
}) {
  const inner = (
    <>
      <span className="service-card-top">
        {icon ? (
          <span className={`service-card-icon icon-tile-${tone}`} aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {badge ? <span className="service-card-badge">{badge}</span> : null}
      </span>
      <span className="service-card-body">
        <strong className="service-card-title">{title}</strong>
        {description ? <span className="service-card-desc">{description}</span> : null}
        {meta ? <span className="service-card-meta">{meta}</span> : null}
      </span>
      <span className="service-card-arrow" aria-hidden="true">
        <ArrowRightIcon size={16} />
      </span>
    </>
  );

  const classes = `service-card service-card-${tone}${emphasised ? " is-emphasised" : ""}`;

  return (
    <Reveal as="div" delay={index * STAGGER_STEP_MS} className="service-card-slot">
      {onClick ? (
        <button type="button" className={classes} onClick={onClick}>
          {inner}
        </button>
      ) : (
        <a className={classes} href={href ?? "#"}>
          {inner}
        </a>
      )}
    </Reveal>
  );
}

/* ---------------------------------------------------------------------------
   SplitFeature — asymmetric image + copy band (the editorial workhorse)
   ------------------------------------------------------------------------- */

export function SplitFeature({
  eyebrow,
  title,
  description,
  bullets,
  action,
  media,
  mediaAlt = "",
  reverse = false,
  tone = "plain",
  badge
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  bullets?: string[];
  action?: ReactNode;
  media: string;
  mediaAlt?: string;
  reverse?: boolean;
  tone?: "plain" | "tint" | "sunken";
  badge?: ReactNode;
}) {
  return (
    <section className={`split-feature split-feature-${tone}${reverse ? " is-reversed" : ""}`}>
      <div className="container split-feature-inner">
        <Reveal className="split-feature-copy" variant={reverse ? "right" : "left"}>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
          {description ? <p className="split-feature-description">{description}</p> : null}
          {bullets && bullets.length > 0 ? (
            <ul className="split-feature-list">
              {bullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {action ? <div className="split-feature-action">{action}</div> : null}
        </Reveal>
        <Reveal className="split-feature-media" variant="scale" delay={120}>
          {badge ? <span className="split-feature-badge">{badge}</span> : null}
          <img src={media} alt={mediaAlt} width={720} height={520} loading="lazy" decoding="async" />
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
   PromoBanner — compact commercial band for cross-sell moments
   ------------------------------------------------------------------------- */

export function PromoBanner({
  eyebrow,
  title,
  description,
  action,
  media,
  mediaAlt = "",
  tone = "brand"
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action: ReactNode;
  media?: string;
  mediaAlt?: string;
  tone?: "brand" | "teal" | "amber";
}) {
  return (
    <Reveal as="section" className={`promo-banner promo-banner-${tone}`}>
      <div className="promo-banner-copy">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
        <div className="promo-banner-action">{action}</div>
      </div>
      {media ? (
        <div className="promo-banner-media">
          <img src={media} alt={mediaAlt} width={480} height={320} loading="lazy" decoding="async" />
        </div>
      ) : null}
    </Reveal>
  );
}

/* ---------------------------------------------------------------------------
   TrustStrip — quiet credibility row (no boxed-card repetition)
   ------------------------------------------------------------------------- */

export function TrustStrip({
  items
}: {
  items: Array<{ title: string; description: string; icon?: ReactNode }>;
}) {
  return (
    <div className="trust-strip">
      {items.map((item, index) => (
        <Reveal as="div" className="trust-strip-item" key={item.title} delay={index * STAGGER_STEP_MS}>
          {item.icon ? (
            <span className="trust-strip-icon" aria-hidden="true">
              {item.icon}
            </span>
          ) : null}
          <strong>{item.title}</strong>
          <span>{item.description}</span>
        </Reveal>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   CTASection — the closing conversion band shared by patient pages
   ------------------------------------------------------------------------- */

export function CTASection({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
  media,
  mediaAlt = "",
  tone = "teal"
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  primaryAction: ReactNode;
  secondaryAction?: ReactNode;
  media?: string;
  mediaAlt?: string;
  tone?: "teal" | "brand" | "amber";
}) {
  return (
    <Reveal as="section" className={`cta-section cta-section-${tone}`}>
      <div className="cta-section-inner">
        <div className="cta-section-copy">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
          <div className="cta-section-actions">
            {primaryAction}
            {secondaryAction}
          </div>
        </div>
        {media ? (
          <div className="cta-section-media">
            <img src={media} alt={mediaAlt} width={560} height={400} loading="lazy" decoding="async" />
          </div>
        ) : null}
      </div>
    </Reveal>
  );
}

/* ---------------------------------------------------------------------------
   CareTimeline — the journey storytelling primitive
   ------------------------------------------------------------------------- */

export function CareTimeline({
  children,
  className = "",
  label
}: PropsWithChildren<{ className?: string; label: string }>) {
  return (
    <ol className={`care-timeline ${className}`.trim()} aria-label={label}>
      {children}
    </ol>
  );
}

export function CareTimelineStage({
  order,
  title,
  meta,
  description,
  children,
  state = "upcoming",
  onSelect,
  selectLabel
}: {
  order: number | string;
  title: string;
  /** Short stage taxonomy line, e.g. "Active treatment". */
  meta?: string;
  description?: string;
  children?: ReactNode;
  state?: "done" | "current" | "upcoming";
  /** Makes the whole stage an interactive control. */
  onSelect?: () => void;
  selectLabel?: string;
}) {
  const classes = `care-timeline-stage is-${state}`;

  const body = (
    <>
      <span className="care-timeline-marker" aria-hidden="true">
        {state === "done" ? "✓" : order}
      </span>
      <span className="care-timeline-body">
        <span className="care-timeline-title-row">
          <strong className="care-timeline-title">{title}</strong>
          {state === "current" ? <span className="care-timeline-flag">You are here</span> : null}
        </span>
        {meta ? <span className="care-timeline-meta">{meta}</span> : null}
        {description ? <span className="care-timeline-description">{description}</span> : null}
        {children}
      </span>
    </>
  );

  return (
    <li className={classes}>
      {onSelect ? (
        <button
          type="button"
          className="care-timeline-button"
          onClick={onSelect}
          aria-current={state === "current" ? "step" : undefined}
          aria-label={selectLabel}
        >
          {body}
        </button>
      ) : (
        <div className="care-timeline-static" aria-current={state === "current" ? "step" : undefined}>
          {body}
        </div>
      )}
    </li>
  );
}

/* ---------------------------------------------------------------------------
   EditorialMediaCard — image-led content card (articles, stories, trials)
   ------------------------------------------------------------------------- */

export function EditorialMediaCard({
  media,
  mediaAlt = "",
  eyebrow,
  title,
  description,
  meta,
  footer,
  onClick,
  href,
  index = 0,
  tone = "neutral",
  mediaAspect = "16 / 10"
}: {
  media?: string;
  mediaAlt?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  meta?: ReactNode;
  footer?: ReactNode;
  onClick?: () => void;
  href?: string;
  index?: number;
  tone?: "neutral" | "teal" | "blue" | "amber";
  mediaAspect?: string;
}) {
  const content = (
    <>
      {media ? (
        <span className="editorial-media-card-media" style={{ aspectRatio: mediaAspect }}>
          <img src={media} alt={mediaAlt} loading="lazy" decoding="async" />
        </span>
      ) : null}
      <span className="editorial-media-card-body">
        <span className="editorial-media-card-head">
          {eyebrow ? <span className="editorial-media-card-eyebrow">{eyebrow}</span> : null}
          {meta ? <span className="editorial-media-card-meta">{meta}</span> : null}
        </span>
        <strong className="editorial-media-card-title">{title}</strong>
        {description ? <span className="editorial-media-card-desc">{description}</span> : null}
        {footer ? <span className="editorial-media-card-footer">{footer}</span> : null}
      </span>
    </>
  );

  return (
    <Reveal as="div" delay={index * STAGGER_STEP_MS} className="editorial-media-card-slot">
      {onClick ? (
        <button type="button" className={`editorial-media-card is-${tone}`} onClick={onClick}>
          {content}
        </button>
      ) : (
        <a className={`editorial-media-card is-${tone}`} href={href ?? "#"}>
          {content}
        </a>
      )}
    </Reveal>
  );
}
