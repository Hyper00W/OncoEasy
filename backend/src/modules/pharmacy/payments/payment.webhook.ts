import { OrderStatus, PaymentStatus } from "@prisma/client";
import express, { Router } from "express";
import type { RequestHandler } from "express";

import { env } from "../../../config/env";
import { prisma } from "../../../database/prisma";
import { AppError } from "../../../errors/app-error";
import { getPaymentGateway, isPaymentGatewayEnabled } from "../../../payments/payment-gateway";
import { RazorpayPaymentGateway } from "../../../payments/razorpay-gateway";
import { toMinorUnits } from "./payment.service";

type WebhookPaymentEntity = {
  id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
};

type WebhookPayload = {
  event?: string;
  payload?: { payment?: { entity?: WebhookPaymentEntity } };
};

export const paymentWebhookRouter = Router();

/**
 * Gateway webhook endpoint. It is mounted BEFORE the global JSON body parser
 * so the raw request body stays available for signature verification. The
 * signature is verified in constant time against the configured webhook
 * secret; processing is idempotent and unsupported events are ignored safely.
 */
paymentWebhookRouter.post(
  "/",
  express.raw({ type: "*/*", limit: "256kb" }),
  (async (request, response, next) => {
    try {
      if (!isPaymentGatewayEnabled() || !env.PAYMENT_GATEWAY_WEBHOOK_SECRET) {
        throw new AppError(503, "WEBHOOK_NOT_CONFIGURED", "Payment webhooks are not configured");
      }

      const signature = request.header("x-razorpay-signature");
      const rawBody = request.body;
      if (!signature || !Buffer.isBuffer(rawBody)) {
        throw new AppError(400, "WEBHOOK_SIGNATURE_INVALID", "Webhook signature verification failed");
      }
      if (!RazorpayPaymentGateway.verifyWebhookSignature(rawBody, signature, env.PAYMENT_GATEWAY_WEBHOOK_SECRET)) {
        throw new AppError(400, "WEBHOOK_SIGNATURE_INVALID", "Webhook signature verification failed");
      }

      let parsed: WebhookPayload;
      try {
        parsed = JSON.parse(rawBody.toString("utf8")) as WebhookPayload;
      } catch (_error) {
        throw new AppError(400, "WEBHOOK_PAYLOAD_INVALID", "Webhook payload could not be parsed");
      }

      const handled = await processWebhookEvent(parsed);
      response.status(200).json({ success: true, data: { handled } });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler
);

async function processWebhookEvent(payload: WebhookPayload): Promise<boolean> {
  const event = payload.event ?? "";
  if (event !== "payment.captured" && event !== "payment.failed") {
    return false; // unsupported events are ignored safely
  }

  const entity = payload.payload?.payment?.entity;
  if (!entity?.id || !entity.order_id || typeof entity.amount !== "number") {
    return false;
  }

  const gateway = getPaymentGateway();
  const payment = await prisma.payment.findFirst({
    where: { providerOrderId: entity.order_id, provider: gateway.name }
  });
  if (!payment || payment.method !== "PREPAID") {
    return false; // not a gateway-managed payment (e.g. COD or legacy marker)
  }

  let expectedMinor: number;
  try {
    expectedMinor = toMinorUnits(payment.amount);
  } catch (_error) {
    return false;
  }
  if (entity.currency !== payment.currency || entity.amount !== expectedMinor) {
    return false; // amount mismatches are never applied
  }

  if (event === "payment.captured") {
    await prisma.$transaction([
      prisma.payment.updateMany({
        where: {
          id: payment.id,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED, PaymentStatus.FAILED] }
        },
        data: {
          status: PaymentStatus.PAID,
          providerPaymentId: entity.id,
          failureCode: null,
          failureMessage: null,
          paidAt: new Date()
        }
      }),
      prisma.order.updateMany({
        where: { id: payment.orderId, status: OrderStatus.PENDING_PAYMENT },
        data: { status: OrderStatus.PAID }
      })
    ]);
    return true;
  }

  await prisma.payment.updateMany({
    where: { id: payment.id, status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED] } },
    data: {
      status: PaymentStatus.FAILED,
      providerPaymentId: entity.id,
      failureCode: "GATEWAY_PAYMENT_FAILED",
      failureMessage: "The gateway reported the payment as failed"
    }
  });
  return true;
}
