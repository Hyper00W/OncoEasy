type DeliveryRecord = {
  id: string;
  mode: string;
  status: string;
  trackingNumber: string | null;
  courierName: string | null;
  assignedAt: Date | null;
  outForDeliveryAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  order: {
    id: string;
    patientId: string;
    deliveryPincode: string | null;
    status: string;
    currency: string;
    totalAmount: { toFixed(decimalPlaces: number): string };
    items: Array<{ quantity: number; productNameSnapshot: string }>;
  };
  agentId: string | null;
  proofs?: Array<{ id: string; type: string; documentName: string; mimeType: string; createdAt: Date }>;
};

export function toDeliveryAgentResponse(delivery: DeliveryRecord) {
  return {
    id: delivery.id,
    mode: delivery.mode,
    status: delivery.status,
    agentId: delivery.agentId,
    trackingNumber: delivery.trackingNumber,
    courierName: delivery.courierName,
    assignedAt: delivery.assignedAt?.toISOString() ?? null,
    outForDeliveryAt: delivery.outForDeliveryAt?.toISOString() ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    failedAt: delivery.failedAt?.toISOString() ?? null,
    failureReason: delivery.failureReason,
    order: {
      id: delivery.order.id,
      patientId: delivery.order.patientId,
      deliveryPincode: delivery.order.deliveryPincode,
      status: delivery.order.status,
      currency: delivery.order.currency,
      totalAmount: delivery.order.totalAmount.toFixed(2),
      items: delivery.order.items
    },
    proofs: delivery.proofs?.map((proof) => ({
      id: proof.id,
      type: proof.type,
      documentName: proof.documentName,
      mimeType: proof.mimeType,
      createdAt: proof.createdAt.toISOString()
    })) ?? []
  };
}