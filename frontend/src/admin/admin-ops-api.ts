import {
  listAdminDeliveries,
  listAdminOrders,
  listReviewQueue,
  type AdminOrder,
  type Delivery,
  type Prescription
} from "../pharmacy/pharmacy-api";

export type AdminOpsSnapshot = {
  reviewQueue: Prescription[];
  orders: AdminOrder[];
  ordersPagination: { page: number; pageSize: number; total: number; totalPages: number };
  deliveries: Delivery[];
  deliveriesPagination: { page: number; pageSize: number; total: number; totalPages: number };
};

/**
 * Loads the first pages of the pharmacy operations queues for the admin
 * overview and pharmacy ops view. Uses only existing OPS_ADMIN endpoints
 * (review queue is PHARMACIST+OPS_ADMIN; order/delivery lists are OPS_ADMIN).
 */
export function loadAdminOpsSnapshot(): Promise<AdminOpsSnapshot> {
  return Promise.all([
    listReviewQueue(),
    listAdminOrders({ page: 1, pageSize: 10 }),
    listAdminDeliveries({ page: 1, pageSize: 10 })
  ]).then(([reviewQueue, orders, deliveries]) => ({
    reviewQueue: reviewQueue.items,
    orders: orders.items,
    ordersPagination: orders.pagination,
    deliveries: deliveries.items,
    deliveriesPagination: deliveries.pagination
  }));
}

/** Formats a delivery summary from its order snapshot (existing fields). */
export function describeDelivery(delivery: Delivery): string {
  const mode = delivery.mode === "LOCAL" ? "Local" : "Courier";
  const agent = delivery.agentId ? "agent assigned" : "no agent";
  return `${mode} • ${agent}`;
}
