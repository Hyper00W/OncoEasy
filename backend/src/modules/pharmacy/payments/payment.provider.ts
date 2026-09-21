export interface PaymentProvider {
  readonly name: string;
}

export const pendingPaymentProvider: PaymentProvider = {
  name: "PENDING_PROVIDER_INTEGRATION"
};