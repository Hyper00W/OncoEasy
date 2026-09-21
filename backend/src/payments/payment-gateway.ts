import { env } from "../config/env";
import { AppError } from "../errors/app-error";

import { RazorpayPaymentGateway } from "./razorpay-gateway";

export type GatewayOrderInput = {
  /** Server-authoritative amount in minor units (paise). Never derived from the client. */
  amountMinor: number;
  currency: string;
  /** Internal reference (the OncoEasy order id) echoed by the gateway. */
  receipt: string;
};

export type GatewayOrder = {
  gatewayOrderId: string;
  amountMinor: number;
  currency: string;
  status: string;
};

export type GatewayPaymentStatus = "CAPTURED" | "AUTHORIZED" | "FAILED" | string;

export type GatewayPayment = {
  gatewayPaymentId: string;
  gatewayOrderId: string;
  amountMinor: number;
  currency: string;
  status: GatewayPaymentStatus;
};

export type SignatureVerificationInput = {
  gatewayOrderId: string;
  gatewayPaymentId: string;
  gatewaySignature: string;
};

/**
 * Provider-agnostic payment-gateway abstraction. Feature modules use this
 * interface only; vendor details live in the adapter implementations.
 */
export interface PaymentGateway {
  readonly name: string;
  /** Public identifier safe to expose to the frontend for checkout. */
  readonly publicKeyId: string;
  createGatewayOrder(input: GatewayOrderInput): Promise<GatewayOrder>;
  /** Constant-time server-side verification; throws a safe AppError on failure. */
  verifyPaymentSignature(input: SignatureVerificationInput): void;
  fetchGatewayPayment(gatewayPaymentId: string): Promise<GatewayPayment>;
}

/**
 * Deterministic in-memory gateway for tests. It is reachable ONLY through the
 * explicit test-state seam (setPaymentGatewayState); the request path never
 * falls back to it — with the gateway disabled the legacy pending-payment
 * behavior applies unchanged, and with it enabled the real adapter is used.
 */
export class MockPaymentGateway implements PaymentGateway {
  readonly name = "mock";
  readonly publicKeyId = "mock_public_key_id";
  readonly createdOrders: GatewayOrder[] = [];
  readonly verificationAttempts: Array<SignatureVerificationInput & { valid: boolean }> = [];
  private readonly payments = new Map<string, GatewayPayment>();
  private orderSequence = 0;
  private paymentSequence = 0;

  async createGatewayOrder(input: GatewayOrderInput): Promise<GatewayOrder> {
    const order: GatewayOrder = {
      gatewayOrderId: `mock_order_${++this.orderSequence}`,
      amountMinor: input.amountMinor,
      currency: input.currency,
      status: "created"
    };
    this.createdOrders.push(order);
    return order;
  }

  /** Deterministic signature the mock accepts for a payment. */
  signatureFor(gatewayOrderId: string, gatewayPaymentId: string): string {
    return `mock-sig:${gatewayOrderId}:${gatewayPaymentId}`;
  }

  /** Simulates a gateway payment for an order (captured by default) and returns its id. */
  simulateSuccessfulPayment(
    gatewayOrderId: string,
    overrides?: Partial<Pick<GatewayPayment, "status" | "amountMinor" | "currency">>
  ): string {
    const order = this.createdOrders.find((candidate) => candidate.gatewayOrderId === gatewayOrderId);
    if (!order) {
      throw new AppError(404, "PAYMENT_GATEWAY_ERROR", "Payment gateway order was not found");
    }
    const gatewayPaymentId = `mock_pay_${++this.paymentSequence}`;
    this.payments.set(gatewayPaymentId, {
      gatewayPaymentId,
      gatewayOrderId,
      amountMinor: overrides?.amountMinor ?? order.amountMinor,
      currency: overrides?.currency ?? order.currency,
      status: overrides?.status ?? "CAPTURED"
    });
    return gatewayPaymentId;
  }

  verifyPaymentSignature(input: SignatureVerificationInput): void {
    const valid = input.gatewaySignature === this.signatureFor(input.gatewayOrderId, input.gatewayPaymentId);
    this.verificationAttempts.push({ ...input, valid });
    if (!valid) {
      throw new AppError(400, "PAYMENT_SIGNATURE_INVALID", "Payment signature verification failed");
    }
  }

  async fetchGatewayPayment(gatewayPaymentId: string): Promise<GatewayPayment> {
    const payment = this.payments.get(gatewayPaymentId);
    if (!payment) {
      throw new AppError(404, "PAYMENT_GATEWAY_ERROR", "Payment gateway payment was not found");
    }
    return payment;
  }

  clear(): void {
    this.createdOrders.length = 0;
    this.verificationAttempts.length = 0;
    this.payments.clear();
    this.orderSequence = 0;
    this.paymentSequence = 0;
  }
}

type PaymentGatewayState = {
  enabled: boolean;
  gateway: PaymentGateway;
};

let state = createConfiguredState();

function createConfiguredState(): PaymentGatewayState {
  if (!env.PAYMENT_GATEWAY_ENABLED) {
    // Disabled: the mock is never used by the request path; the pharmacy
    // payment service keeps its legacy pending-integration behavior.
    return { enabled: false, gateway: new MockPaymentGateway() };
  }

  // Credential completeness is validated in config/env.ts at startup.
  return {
    enabled: true,
    gateway: new RazorpayPaymentGateway({
      keyId: env.PAYMENT_GATEWAY_KEY_ID as string,
      keySecret: env.PAYMENT_GATEWAY_KEY_SECRET as string
    })
  };
}

export function setPaymentGatewayState(nextState: PaymentGatewayState): void {
  state = nextState;
}

export function resetPaymentGatewayState(): void {
  state = createConfiguredState();
}

export function isPaymentGatewayEnabled(): boolean {
  return state.enabled;
}

export function getPaymentGateway(): PaymentGateway {
  return state.gateway;
}
