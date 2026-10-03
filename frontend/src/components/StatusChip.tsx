import { formatStatusLabel, statusTone } from "./status-utils";

/** Renders a backend status enum value as a tone-coded, text-labelled chip. */
export function StatusChip({ status }: { status: string }) {
  return (
    <span className={`status-chip status-chip-${statusTone(status)}`}>{formatStatusLabel(status)}</span>
  );
}
