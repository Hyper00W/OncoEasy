type PaymentRecord = {
  id: string;
  method: string;
  status: string;
  amount: { toFixed(decimalPlaces: number): string };
  currency: string;
  provider: string;
  providerPaymentId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toPaymentResponse(payment: PaymentRecord) {
  return {
    id: payment.id,
    method: payment.method,
    status: payment.status,
    amount: payment.amount.toFixed(2),
    currency: payment.currency,
    provider: payment.provider,
    providerPaymentId: payment.providerPaymentId,
    failureCode: payment.failureCode,
    failureMessage: payment.failureMessage,
    paidAt: payment.paidAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString()
  };
}