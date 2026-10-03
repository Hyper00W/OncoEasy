import { listReviewQueue } from "../pharmacy/pharmacy-api";

export type PharmacistWorkspaceData = {
  /** Prescriptions in PENDING_REVIEW — the verification queue. */
  reviewQueue: Awaited<ReturnType<typeof listReviewQueue>>["items"];
};

/**
 * Loads the pharmacist's operational snapshot from endpoints the PHARMACIST
 * role is actually authorized to call (Phase 6.4 limitation: the order
 * listing APIs are OPS_ADMIN-only, so fulfillment queues are not shown to
 * pharmacists — documented, not faked).
 */
export function loadPharmacistWorkspace(): Promise<PharmacistWorkspaceData> {
  return listReviewQueue().then((reviewQueue) => ({
    reviewQueue: reviewQueue.items
  }));
}
