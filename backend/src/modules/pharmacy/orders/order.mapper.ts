type OrderRecord = {
  id: string;
  status: string;
  originType: string;
  currency: string;
  subtotal: { toFixed(decimalPlaces: number): string };
  deliveryFee: { toFixed(decimalPlaces: number): string };
  totalAmount: { toFixed(decimalPlaces: number): string };
  deliveryPincode: string | null;
  prescriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPriceSnapshot: { toFixed(decimalPlaces: number): string };
    productNameSnapshot: string;
  }>;
};

export function toOrderResponse(order: OrderRecord) {
  return {
    id: order.id,
    status: order.status,
    originType: order.originType,
    currency: order.currency,
    subtotal: order.subtotal.toFixed(2),
    deliveryFee: order.deliveryFee.toFixed(2),
    totalAmount: order.totalAmount.toFixed(2),
    deliveryPincode: order.deliveryPincode,
    prescription: order.prescriptionId ? { id: order.prescriptionId } : null,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPriceSnapshot.toFixed(2),
      name: item.productNameSnapshot
    })),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString()
  };
}