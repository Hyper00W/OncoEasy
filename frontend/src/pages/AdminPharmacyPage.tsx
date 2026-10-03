import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  getAdminOrder,
  getAdminDelivery,
  listAdminOrders,
  listAdminDeliveries,
  type AdminOrder,
  type Delivery
} from "../pharmacy/pharmacy-api";
import { AdminPortalShell } from "../admin/AdminPortalShell";
import { AdminDetailPanel } from "../components/admin/AdminDetailPanel";
import { AdminFilterBar, AdminSelectFilter } from "../components/admin/AdminFilterBar";
import { AdminPagination, AdminTable, type AdminColumn } from "../components/admin/AdminTable";
import { StatusChip } from "../components/StatusChip";
import { Button } from "../components/ui";
import type { Navigate } from "../components/navigation-types";
import { formatDateTime, formatStatusLabel } from "../components/status-utils";


const ORDER_STATUSES = [
  "DRAFT", "PENDING_PRESCRIPTION", "PENDING_PHARMACIST_REVIEW", "PENDING_PAYMENT",
  "PAID", "PROCESSING", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "SHIPPED",
  "DELIVERED", "CANCELLED"
] as const;

const DELIVERY_STATUSES = [
  "PENDING", "ASSIGNED", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY",
  "SHIPPED", "DELIVERED", "FAILED", "CANCELLED"
] as const;

const pageSize = 10;

/**
 * Admin pharmacy operations (Phase 6.5): orders and deliveries queues over
 * the existing OPS_ADMIN endpoints. Server-side status/mode filtering and
 * pagination exactly as the backend supports; detail panels read the real
 * GET-by-id endpoints. No transition actions are offered here — the backend
 * exposes no OPS_ADMIN order-state mutations, and fulfillment moves through
 * patient payment, pharmacist verification, and delivery-agent workflows.
 */
export function AdminPharmacyPage({ navigate }: { navigate: Navigate }) {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <AdminPortalShell navigate={navigate} activePath="/admin/pharmacy" title="Pharmacy & orders">
      <div className="admin-sections">
        <OrdersQueue />
        <DeliveriesQueue />
      </div>
    </AdminPortalShell>
  );
}

function OrdersQueue() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize, total: 0, totalPages: 1 });
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState<{ page: number; status: string }>({ page: 1, status: "" });
  const [selected, setSelected] = useState<AdminOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestTokenRef = useRef(0);

  useEffect(() => {
    const requestToken = ++requestTokenRef.current;
    listAdminOrders({ page: query.page, pageSize, status: query.status || undefined })
      .then((response) => {
        if (requestTokenRef.current !== requestToken) return;
        setOrders(response.items);
        setPagination(response.pagination);
        setError(null);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (requestTokenRef.current !== requestToken) return;
        setError(describeError(requestError, "The order queue could not be loaded."));
        setLoading(false);
      });
  }, [query]);

  function openOrder(orderId: string): void {
    setError(null);
    getAdminOrder(orderId)
      .then(setSelected)
      .catch((requestError: unknown) => setError(describeError(requestError, "That order could not be opened.")));
  }

  const columns: AdminColumn<AdminOrder>[] = [
    {
      header: "Order",
      label: "Order",
      cell: (order) => (
        <div>
          <span className="mono">{order.id.slice(0, 8)}</span>
          <span className="table-subtext">{formatDateTime(order.createdAt)}</span>
        </div>
      )
    },
    {
      header: "Patient",
      label: "Patient",
      cell: (order) => order.patient.fullName
    },
    {
      header: "Items",
      label: "Items",
      cell: (order) => String(order.items.length)
    },
    {
      header: "Total",
      label: "Total",
      cell: (order) => `${order.currency} ${order.totalAmount}`
    },
    {
      header: "Payment",
      label: "Payment",
      cell: (order) =>
        order.payments.length === 0
          ? <span className="muted">None initiated</span>
          : order.payments.map((payment, index) => (
            <span className="table-subtext" key={`${payment.method}-${index}`}>
              {formatStatusLabel(payment.method)} • {formatStatusLabel(payment.status)}
            </span>
          ))
    },
    {
      header: "Status",
      label: "Status",
      cell: (order) => <StatusChip status={order.status} />
    },
    {
      header: "Actions",
      hideHeader: true,
      label: "Actions",
      cell: (order) => (
        <Button className="button-link" type="button" onClick={() => openOrder(order.id)}>
          Details
        </Button>
      )
    }
  ];

  return (
    <section className="panel admin-queue-panel" aria-label="Order queue">
      <div className="queue-head">
        <h2>Orders</h2>
        <Button className="button-link" type="button" onClick={() => setQuery({ ...query })}>
          Refresh
        </Button>
      </div>
      <AdminFilterBar
        onApply={(event) => {
          event.preventDefault();
          setQuery({ page: 1, status });
        }}
        onClear={() => {
          setStatus("");
          setQuery({ page: 1, status: "" });
        }}
      >
        <AdminSelectFilter
          id="admin-orders-status"
          label="Order status"
          value={status}
          options={ORDER_STATUSES}
          allLabel="All statuses"
          onChange={setStatus}
        />
      </AdminFilterBar>

      <AdminTable
        columns={columns}
        rows={orders}
        getKey={(order) => order.id}
        loading={loading}
        loadingLabel="Loading orders..."
        emptyTitle="No orders match this filter"
        emptyHint={query.status ? `No orders are currently ${formatStatusLabel(query.status).toLowerCase()}.` : "Orders appear here once patients move through the pharmacy."}
        error={error}
        onRetry={() => setQuery({ ...query })}
      />

      <AdminPagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        total={pagination.total}
        singular="order"
        plural="orders"
        disabled={loading}
        onPrevious={() => setQuery({ ...query, page: pagination.page - 1 })}
        onNext={() => setQuery({ ...query, page: pagination.page + 1 })}
      />

      {selected ? (
        <AdminDetailPanel
          eyebrow={formatStatusLabel(selected.status)}
          title={`Order ${selected.id.slice(0, 8)}`}
          meta={`${selected.patient.fullName} • placed ${formatDateTime(selected.createdAt)}`}
          onClose={() => setSelected(null)}
          rows={[
            { label: "Status", value: <StatusChip status={selected.status} /> },
            { label: "Origin", value: formatStatusLabel(selected.originType) },
            { label: "Subtotal", value: `${selected.currency} ${selected.subtotal}` },
            { label: "Delivery fee", value: `${selected.currency} ${selected.deliveryFee}` },
            { label: "Total", value: `${selected.currency} ${selected.totalAmount}` },
            { label: "Delivery pincode", value: selected.deliveryPincode || "Not set by patient" },
            {
              label: "Payment",
              value:
                selected.payments.length === 0
                  ? "None initiated"
                  : selected.payments.map((payment) => `${formatStatusLabel(payment.method)} ${formatStatusLabel(payment.status)} (${payment.amount} ${payment.currency})`).join(", ")
            },
            {
              label: "Delivery",
              value: selected.delivery
                ? `${formatStatusLabel(selected.delivery.mode)} • ${formatStatusLabel(selected.delivery.status)}${selected.delivery.agentId ? " • agent assigned" : " • no agent"}`
                : "Not created yet"
            },
            { label: "Prescription", value: selected.prescription ? `${selected.prescription.id.slice(0, 8)} (verified during order)` : "Not required" }
          ]}
        >
          <h3>Items</h3>
          <div className="stack-list">
            {selected.items.map((item) => (
              <div className="list-row" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span className="muted">Quantity {item.quantity} • {selected.currency} {item.unitPrice}</span>
                </div>
              </div>
            ))}
          </div>
        </AdminDetailPanel>
      ) : null}
    </section>
  );
}

function DeliveriesQueue() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize, total: 0, totalPages: 1 });
  const [status, setStatus] = useState("");
  const [mode, setMode] = useState("");
  const [query, setQuery] = useState<{ page: number; status: string; mode: string }>({ page: 1, status: "", mode: "" });
  const [selected, setSelected] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestTokenRef = useRef(0);

  useEffect(() => {
    const requestToken = ++requestTokenRef.current;
    listAdminDeliveries({ page: query.page, pageSize, status: query.status || undefined, mode: query.mode || undefined })
      .then((response) => {
        if (requestTokenRef.current !== requestToken) return;
        setDeliveries(response.items);
        setPagination(response.pagination);
        setError(null);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (requestTokenRef.current !== requestToken) return;
        setError(describeError(requestError, "The delivery queue could not be loaded."));
        setLoading(false);
      });
  }, [query]);

  function openDelivery(deliveryId: string): void {
    setError(null);
    getAdminDelivery(deliveryId)
      .then(setSelected)
      .catch((requestError: unknown) => setError(describeError(requestError, "That delivery could not be opened.")));
  }

  const columns: AdminColumn<Delivery>[] = [
    {
      header: "Delivery",
      label: "Delivery",
      cell: (delivery) => (
        <div>
          <span className="mono">{delivery.id.slice(0, 8)}</span>
          <span className="table-subtext">Order {delivery.order.id.slice(0, 8)}</span>
        </div>
      )
    },
    {
      header: "Mode",
      label: "Mode",
      cell: (delivery) => formatStatusLabel(delivery.mode)
    },
    {
      header: "Pincode",
      label: "Pincode",
      cell: (delivery) => delivery.order.deliveryPincode ?? <span className="muted">Not set</span>
    },
    {
      header: "Total",
      label: "Total",
      cell: (delivery) => `${delivery.order.currency} ${delivery.order.totalAmount}`
    },
    {
      header: "Status",
      label: "Status",
      cell: (delivery) => <StatusChip status={delivery.status} />
    },
    {
      header: "Actions",
      hideHeader: true,
      label: "Actions",
      cell: (delivery) => (
        <Button className="button-link" type="button" onClick={() => openDelivery(delivery.id)}>
          Details
        </Button>
      )
    }
  ];

  return (
    <section className="panel admin-queue-panel" aria-label="Delivery queue">
      <div className="queue-head">
        <h2>Deliveries</h2>
        <Button className="button-link" type="button" onClick={() => setQuery({ ...query })}>
          Refresh
        </Button>
      </div>
      <AdminFilterBar
        onApply={(event) => {
          event.preventDefault();
          setQuery({ page: 1, status, mode });
        }}
        onClear={() => {
          setStatus("");
          setMode("");
          setQuery({ page: 1, status: "", mode: "" });
        }}
      >
        <AdminSelectFilter
          id="admin-deliveries-status"
          label="Delivery status"
          value={status}
          options={DELIVERY_STATUSES}
          allLabel="All statuses"
          onChange={setStatus}
        />
        <AdminSelectFilter
          id="admin-deliveries-mode"
          label="Delivery mode"
          value={mode}
          options={["LOCAL", "COURIER"]}
          allLabel="All modes"
          onChange={setMode}
        />
      </AdminFilterBar>

      <AdminTable
        columns={columns}
        rows={deliveries}
        getKey={(delivery) => delivery.id}
        loading={loading}
        loadingLabel="Loading deliveries..."
        emptyTitle="No deliveries match this filter"
        emptyHint="Deliveries are created when patients validate delivery at checkout."
        error={error}
        onRetry={() => setQuery({ ...query })}
      />

      <AdminPagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        total={pagination.total}
        singular="delivery"
        plural="deliveries"
        disabled={loading}
        onPrevious={() => setQuery({ ...query, page: pagination.page - 1 })}
        onNext={() => setQuery({ ...query, page: pagination.page + 1 })}
      />

      {selected ? (
        <AdminDetailPanel
          eyebrow={formatStatusLabel(selected.status)}
          title={`Delivery ${selected.id.slice(0, 8)}`}
          meta={`Order ${selected.order.id.slice(0, 8)} • ${formatStatusLabel(selected.mode)}`}
          onClose={() => setSelected(null)}
          rows={[
            { label: "Status", value: <StatusChip status={selected.status} /> },
            { label: "Pincode", value: selected.order.deliveryPincode || "Not set" },
            { label: "Order status", value: formatStatusLabel(selected.order.status) },
            { label: "Agent", value: selected.agentId ? `${selected.agentId.slice(0, 8)} assigned` : "Not assigned" },
            { label: "Tracking", value: selected.trackingNumber ?? "Not available" },
            { label: "Courier", value: selected.courierName ?? "Not available" },
            selected.assignedAt ? { label: "Assigned", value: formatDateTime(selected.assignedAt) } : null,
            selected.outForDeliveryAt ? { label: "Out for delivery", value: formatDateTime(selected.outForDeliveryAt) } : null,
            selected.deliveredAt ? { label: "Delivered", value: formatDateTime(selected.deliveredAt) } : null,
            selected.failedAt ? { label: "Failed", value: `${formatDateTime(selected.failedAt)} — ${selected.failureReason ?? "no reason recorded"}` } : null
          ].filter(Boolean) as { label: string; value: React.ReactNode }[]}
        >
          <h3>Items</h3>
          <div className="stack-list">
            {selected.order.items.map((item) => (
              <div className="list-row" key={`${item.productNameSnapshot}-${item.quantity}`}>
                <div>
                  <strong>{item.productNameSnapshot}</strong>
                  <span className="muted">Quantity {item.quantity}</span>
                </div>
              </div>
            ))}
          </div>
          {selected.proofs.length > 0 ? (
            <>
              <h3>Delivery proofs</h3>
              <div className="stack-list">
                {selected.proofs.map((proof) => (
                  <div className="list-row" key={proof.id}>
                    <div>
                      <strong>{formatStatusLabel(proof.type)}</strong>
                      <span className="muted">{proof.documentName} • {formatDateTime(proof.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </AdminDetailPanel>
      ) : null}
    </section>
  );
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
