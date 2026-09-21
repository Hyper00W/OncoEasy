import { createHmac, timingSafeEqual } from "node:crypto";

import { AppError } from "../errors/app-error";

import type { GatewayOrder, GatewayOrderInput, GatewayPayment, PaymentGateway, SignatureVerificationInput } from "./payment-gateway";

const DEFAULT_TIMEOUT_MS = 10_000;

export type RazorpayGatewayOptions = {
  keyId: string;
  keySecret: string;
  baseUrl?: string;
  timeoutMs?: number;
};

function safeEqual(expectedHex: string, providedHex: string): boolean {
  const expected = Buffer.from(expectedHex, "utf8");
  const provided = Buffer.from(providedHex, "utf8");
  if (expected.length !== provided.length) {
    // Still perform a comparison to keep timing uniform for wrong lengths.
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(expected, provided);
}

/**
 * Production payment gateway backed by the Razorpay server-side API over
 * plain HTTPS. Credentials come exclusively from backend environment
 * configuration; nothing is hardcoded here.
 *
 * Single-attempt calls (no blind retries). Errors are converted into safe
 * application errors with constant messages so the key secret and internal
 * details never leak into logs or API responses.
 */
export class RazorpayPaymentGateway implements PaymentGateway {
  readonly name = "razorpay";
  readonly publicKeyId: string;
  private readonly keySecret: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: RazorpayGatewayOptions) {
    this.publicKeyId = options.keyId;
    this.keySecret = options.keySecret;
    this.baseUrl = options.baseUrl?.replace(/\/+$/, "") ?? "https://api.razorpay.com";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async createGatewayOrder(input: GatewayOrderInput): Promise<GatewayOrder> {
    const body = await this.request("/v1/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: input.amountMinor,
        currency: input.currency,
        receipt: input.receipt
      })
    });

    return {
      gatewayOrderId: String(body.id),
      amountMinor: Number(body.amount),
      currency: String(body.currency),
      status: String(body.status ?? "created")
    };
  }

  async fetchGatewayPayment(gatewayPaymentId: string): Promise<GatewayPayment> {
    const body = await this.request(`/v1/payments/${encodeURIComponent(gatewayPaymentId)}`, { method: "GET" });

    return {
      gatewayPaymentId: String(body.id),
      gatewayOrderId: String(body.order_id),
      amountMinor: Number(body.amount),
      currency: String(body.currency),
      status: normalizeGatewayStatus(String(body.status ?? ""))
    };
  }

  verifyPaymentSignature(input: SignatureVerificationInput): void {
    const expected = createHmac("sha256", this.keySecret)
      .update(`${input.gatewayOrderId}|${input.gatewayPaymentId}`)
      .digest("hex");

    if (!safeEqual(expected, input.gatewaySignature)) {
      throw new AppError(400, "PAYMENT_SIGNATURE_INVALID", "Payment signature verification failed");
    }
  }

  /**
   * Verifies a webhook signature: HMAC-SHA256 over the raw request body using
   * the webhook secret, compared in constant time.
   */
  static verifyWebhookSignature(rawBody: Buffer, signature: string, webhookSecret: string): boolean {
    const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    return safeEqual(expected, signature);
  }

  private async request(path: string, init: { method: "GET" | "POST"; body?: string }): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: {
          // Official Razorpay server-side auth: Basic base64(key_id:key_secret).
          Authorization: `Basic ${Buffer.from(`${this.publicKeyId}:${this.keySecret}`).toString("base64")}`,
          "Content-Type": "application/json"
        },
        body: init.body,
        signal: controller.signal
      });
    } catch (_error) {
      throw unreachableError();
    } finally {
      clearTimeout(timeout);
    }

    const rawBody = await response.text();

    if (!response.ok) {
      throw new AppError(502, "PAYMENT_GATEWAY_ERROR", "Payment gateway request failed");
    }

    try {
      return JSON.parse(rawBody) as Record<string, unknown>;
    } catch (_error) {
      throw new AppError(502, "PAYMENT_GATEWAY_ERROR", "Payment gateway request failed");
    }
  }
}

function normalizeGatewayStatus(status: string): GatewayPayment["status"] {
  switch (status) {
    case "captured":
      return "CAPTURED";
    case "authorized":
      return "AUTHORIZED";
    case "failed":
      return "FAILED";
    default:
      return status.toUpperCase();
  }
}

function unreachableError(): AppError {
  return new AppError(502, "PAYMENT_GATEWAY_UNREACHABLE", "Payment gateway is unreachable");
}
