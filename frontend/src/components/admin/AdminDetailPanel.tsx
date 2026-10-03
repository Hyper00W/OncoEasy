import type { ReactNode } from "react";

import { Button } from "../ui";

export type DetailRow = {
  label: string;
  value: ReactNode;
};

/**
 * Reusable admin detail panel (Phase 6.5): a titled side panel showing
 * label/value rows plus arbitrary content blocks (items, transcripts,
 * actions). Used by referral, appointment, order, and delivery detail views.
 */
export function AdminDetailPanel({
  eyebrow,
  title,
  meta,
  onClose,
  closeLabel = "Close",
  rows,
  children
}: {
  eyebrow?: string;
  title: ReactNode;
  meta?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  rows?: DetailRow[];
  children?: ReactNode;
}) {
  return (
    <section className="panel admin-detail-panel">
      <div className="detail-header">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
          {meta ? <p className="muted">{meta}</p> : null}
        </div>
        {onClose ? (
          <Button className="button-secondary" type="button" onClick={onClose}>
            {closeLabel}
          </Button>
        ) : null}
      </div>

      {rows && rows.length > 0 ? (
        <dl className="detail-list">
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {children}
    </section>
  );
}
