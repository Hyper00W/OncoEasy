export type StatusTone = "positive" | "attention" | "negative" | "neutral";

const POSITIVE_STATUSES = [
  "CONFIRMED",
  "VERIFIED",
  "DELIVERED",
  "PAID",
  "COMPLETED",
  "FULFILLED",
  "APPROVED",
  "READY_FOR_DELIVERY",
  "ACTIVE"
];

const ATTENTION_STATUSES = [
  "PENDING",
  "PENDING_PAYMENT",
  "PENDING_PRESCRIPTION",
  "PENDING_PHARMACIST_REVIEW",
  "PENDING_REVIEW",
  "PROCESSING",
  "SENT",
  "VIEWED",
  "SUBMITTED",
  "UNDER_REVIEW",
  "OUT_FOR_DELIVERY",
  "ASSIGNED",
  "QUERY",
  "SHIPPED"
];

const NEGATIVE_STATUSES = ["REJECTED", "CANCELLED", "FAILED", "EXPIRED", "NO_SHOW", "INACTIVE"];

export function statusTone(status: string): StatusTone {
  const normalized = status.toUpperCase();
  if (POSITIVE_STATUSES.includes(normalized)) return "positive";
  if (ATTENTION_STATUSES.includes(normalized)) return "attention";
  if (NEGATIVE_STATUSES.includes(normalized)) return "negative";
  return "neutral";
}

export function formatStatusLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
