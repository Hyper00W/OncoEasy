import { Prisma } from "@prisma/client";

type SummaryItem = {
  quantity: number;
  unitPriceSnapshot: { toString(): string };
  product: {
    prescriptionRequired: boolean;
    coldChainRequired: boolean;
  } | null;
};

export function calculateCartSummary(
  currency: string | null,
  items: SummaryItem[]
) {
  const subtotal = items.reduce(
    (total, item) =>
      total.plus(new Prisma.Decimal(item.unitPriceSnapshot.toString()).mul(item.quantity)),
    new Prisma.Decimal(0)
  );

  return {
    subtotal: subtotal.toFixed(2),
    itemCount: items.length,
    totalQuantity: items.reduce((total, item) => total + item.quantity, 0),
    currency,
    hasPrescriptionItems: items.some((item) => item.product?.prescriptionRequired === true),
    hasColdChainItems: items.some((item) => item.product?.coldChainRequired === true)
  };
}