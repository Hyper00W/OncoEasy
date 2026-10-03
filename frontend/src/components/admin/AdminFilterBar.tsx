import { SearchIcon } from "../icons";
import { formatStatusLabel } from "../status-utils";
import { Button } from "../ui";

/**
 * Reusable admin filter bar (Phase 6.5): a compact toolbar wrapping search,
 * select, and date filters plus Apply/Clear. Renders as a wrapping flex row
 * on desktop and stacks on mobile via the shared pharmacy-toolbar pattern.
 */
export function AdminFilterBar({
  children,
  onApply,
  onClear,
  applyLabel = "Apply filters"
}: {
  children?: React.ReactNode;
  onApply: (event: React.FormEvent<HTMLFormElement>) => void;
  onClear?: () => void;
  applyLabel?: string;
}) {
  return (
    <form className="admin-filter-bar" onSubmit={onApply}>
      {children}
      <div className="admin-filter-actions">
        <Button type="submit">{applyLabel}</Button>
        {onClear ? (
          <Button className="button-secondary" type="button" onClick={onClear}>
            Clear
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function AdminSearchInput({
  id,
  label,
  value,
  placeholder,
  onChange
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="admin-search-field">
      <label className="visually-hidden" htmlFor={id}>{label}</label>
      <span className="admin-search-icon" aria-hidden="true"><SearchIcon size={16} /></span>
      <input
        className="input"
        id={id}
        type="search"
        value={value}
        placeholder={placeholder ?? label}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function AdminSelectFilter({
  id,
  label,
  value,
  options,
  allLabel,
  onChange
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  allLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="admin-filter-field">
      <label className="visually-hidden" htmlFor={id}>{label}</label>
      <select
        className="input"
        id={id}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>{formatStatusLabel(option)}</option>
        ))}
      </select>
    </div>
  );
}
