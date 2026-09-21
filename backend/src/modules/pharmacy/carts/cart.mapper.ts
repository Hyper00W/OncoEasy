import { calculateCartSummary } from "./cart.summary";
import { validateCartItems } from "./cart.validation";

type CartWithItems = {
  id: string;
  status: string;
  currency: string;
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPriceSnapshot: { toFixed(decimalPlaces: number): string };
    productNameSnapshot: string;
    product: {
      sku: string;
      name: string;
      price: { toFixed(decimalPlaces: number): string };
      isActive: boolean;
      unitLabel: string | null;
      prescriptionRequired: boolean;
      coldChainRequired: boolean;
      temperatureMinC: { toString(): string } | null;
      temperatureMaxC: { toString(): string } | null;
      minimumQuantity: number;
      regularDeliveryEligible: boolean;
      coldChainDeliveryEligible: boolean;
    };
  }>;
};

export function toCartResponse(cart: CartWithItems | null) {
  const items = cart?.items ?? [];

  return {
    id: cart?.id ?? null,
    status: cart?.status ?? "ACTIVE",
    currency: cart?.currency ?? null,
    items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        sku: item.product.sku,
        name: item.productNameSnapshot,
        quantity: item.quantity,
        unitPrice: item.unitPriceSnapshot.toFixed(2),
        currentUnitPrice: item.product.price.toFixed(2),
        unitLabel: item.product.unitLabel,
        prescriptionRequired: item.product.prescriptionRequired,
        coldChainRequired: item.product.coldChainRequired,
        temperatureMinC: item.product.temperatureMinC?.toString() ?? null,
        temperatureMaxC: item.product.temperatureMaxC?.toString() ?? null,
        minimumQuantity: item.product.minimumQuantity,
        regularDeliveryEligible: item.product.regularDeliveryEligible,
        coldChainDeliveryEligible: item.product.coldChainDeliveryEligible
      })),
    summary: calculateCartSummary(cart?.currency ?? null, items),
    validation: validateCartItems(items)
  };
}