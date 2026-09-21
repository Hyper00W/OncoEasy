type ReferralRecord = {
  id: string;
  status: string;
  viewedAt: Date | null;
  orderedAt: Date | null;
  fulfilledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  doctor?: { id: string; fullName: string };
  patient?: { id: string; fullName: string };
  items: Array<{
    productId: string;
    quantity: number;
    productNameSnapshot: string;
    product: { sku: string; name: string; unitLabel: string | null; price: { toFixed(decimalPlaces: number): string }; currency: string };
  }>;
  order?: { id: string; status: string } | null;
};

export function toDoctorReferralResponse(referral: ReferralRecord) {
  return {
    referralId: referral.id,
    status: referral.status,
    doctor: referral.doctor ? { doctorId: referral.doctor.id, fullName: referral.doctor.fullName } : undefined,
    patient: referral.patient ? { patientId: referral.patient.id, fullName: referral.patient.fullName } : undefined,
    items: referral.items.map((item) => ({
      productId: item.productId,
      sku: item.product.sku,
      name: item.productNameSnapshot,
      quantity: item.quantity,
      unitPrice: item.product.price.toFixed(2),
      currency: item.product.currency,
      unitLabel: item.product.unitLabel
    })),
    order: referral.order ?? null,
    viewedAt: referral.viewedAt?.toISOString() ?? null,
    orderedAt: referral.orderedAt?.toISOString() ?? null,
    fulfilledAt: referral.fulfilledAt?.toISOString() ?? null,
    createdAt: referral.createdAt.toISOString(),
    updatedAt: referral.updatedAt.toISOString()
  };
}

export function toPatientReferralResponse(referral: ReferralRecord) {
  return {
    referralId: referral.id,
    status: referral.status,
    doctor: referral.doctor ? { fullName: referral.doctor.fullName } : undefined,
    items: referral.items.map((item) => ({
      sku: item.product.sku,
      name: item.productNameSnapshot,
      quantity: item.quantity,
      unitPrice: item.product.price.toFixed(2),
      currency: item.product.currency,
      unitLabel: item.product.unitLabel
    })),
    order: referral.order ?? null,
    viewedAt: referral.viewedAt?.toISOString() ?? null,
    orderedAt: referral.orderedAt?.toISOString() ?? null,
    fulfilledAt: referral.fulfilledAt?.toISOString() ?? null,
    createdAt: referral.createdAt.toISOString()
  };
}
