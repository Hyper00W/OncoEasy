import type { ReactNode } from "react";

import { Button, ErrorState } from "../ui";

export type AdminColumn<T> = {
  header: string;
  /** Optional visually hidden header (e.g. actions column). */
  hideHeader?: boolean;
  cell: (row: T) => ReactNode;
  /** String used as the mobile card label via data-label. */
  label?: string;
};

/**
 * Admin table primitive (Phase 6.5). Desktop: semantic table inside a
 * horizontally scrollable container. Mobile (<=760px): rows become stacked
 * cards labelled by the column headers. Loading, empty, and error states are
 * built in so every queue renders consistent feedback.
 */
export function AdminTable<T>({
  columns,
  rows,
  getKey,
  loading,
  loadingLabel = "Loading...",
  emptyTitle,
  emptyHint,
  error,
  onRetry,
  caption
}: {
  columns: AdminColumn<T>[];
  rows: T[];
  getKey: (row: T) => string;
  loading?: boolean;
  loadingLabel?: string;
  emptyTitle: string;
  emptyHint?: string;
  error?: string | null;
  onRetry?: () => void;
  caption?: string;
}) {
  if (error) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }

  if (loading) {
    return (
      <div className="admin-table-wrap" aria-busy="true">
        <SkeletonTable columns={columns.length} />
        <p className="visually-hidden">{loadingLabel}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="empty-state-block" role="status">
        <p className="empty-state-title">{emptyTitle}</p>
        {emptyHint ? <p className="empty-state-hint">{emptyHint}</p> : null}
      </div>
    );
  }

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        {caption ? <caption className="visually-hidden">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.header} scope="col">
                {column.hideHeader ? <span className="visually-hidden">{column.header}</span> : column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getKey(row)}>
              {columns.map((column) => (
                <td key={column.header} data-label={column.label ?? column.header}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkeletonTable({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <table className="admin-table admin-table-skeleton" aria-hidden="true">
      <thead>
        <tr>
          {Array.from({ length: columns }, (_, index) => (
            <th key={index}><span className="skeleton skeleton-text" /></th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, rowIndex) => (
          <tr key={rowIndex}>
            {Array.from({ length: columns }, (_, cellIndex) => (
              <td key={cellIndex}><span className="skeleton skeleton-text" /></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AdminPagination({
  page,
  totalPages,
  total,
  singular = "item",
  plural = "items",
  disabled = false,
  onPrevious,
  onNext
}: {
  page: number;
  totalPages: number;
  total: number;
  singular?: string;
  plural?: string;
  disabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (totalPages <= 1) {
    return <p className="admin-pagination-note">{total} {total === 1 ? singular : plural}</p>;
  }

  return (
    <div className="button-row admin-pagination">
      <Button className="button-secondary" type="button" disabled={disabled || page <= 1} onClick={onPrevious}>
        Previous
      </Button>
      <span className="field-hint">
        Page {page} of {totalPages} • {total} {total === 1 ? singular : plural}
      </span>
      <Button className="button-secondary" type="button" disabled={disabled || page >= totalPages} onClick={onNext}>
        Next
      </Button>
    </div>
  );
}
