import { OrderStatus, PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";

import { prisma } from "../../../database/prisma";
import { AppError } from "../../../errors/app-error";
import { getPaymentGateway, isPaymentGatewayEnabled } from "../../../payments/payment-gateway";
import { assertPaymentMethodEligible } from "./payment.eligibility";
import { toPaymentResponse } from "./payment.mapper";
import { pendingPaymentProvider } from "./payment.provider";
import type { InitiatePaymentInput, VerifyPaymentInput } from "./payment.schemas";

const paymentSelect = {
  id: true,
  method: true,
  status: true,
  amount: true,
  currency: true,
  provider: true,
  providerOrderId: true,
  providerPaymentId: true,
  failureCode: true,
  failureMessage: true,
  paidAt: true,
  createdAt: true,
  updatedAt: true
} as const;

/** Currencies the gateway integration is validated for; Razorpay is INR-first. */
const GATEWAY_SUPPORTED_CURRENCIES = new Set(["INR"]);

/**
 * Converts a server-authoritative Decimal amount into integer minor units
 * (paise). Never accepts a client-provided amount.
 */
export function toMinorUnits(amount: Prisma.Decimal): number {
  const minor = amount.mul(100);
  if (!minor.isInteger()) {
    throw new AppError(500, "PAYMENT_AMOUNT_INVALID", "Payable amount could not be represented in minor units");
  }
  return minor.toNumber();
}

export async function initiatePatientPayment(
  patientId: string,
  orderId: string,
  input: InitiatePaymentInput
) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, patientId },
    select: { id: true, status: true, totalAmount: true, currency: true }
  });
  if (!order) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order was not found");
  }
  if (order.status !== OrderStatus.PENDING_PAYMENT) {
    throw new AppError(409, "ORDER_STATE_CONFLICT", "Order is not awaiting payment");
  }

  const method = input.method as PaymentMethod;
  await assertPaymentMethodEligible(order.id, method);

  try {
    const payment = await prisma.payment.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        method,
        status: PaymentStatus.PENDING,
        amount: order.totalAmount,
        currency: order.currency,
        provider: method === PaymentMethod.COD ? "COD" : pendingPaymentProvider.name
      },
      update: {}
    });

    if (payment.method !== method) {
      throw new AppError(
        409,
        "PAYMENT_ALREADY_INITIATED",
        "A payment method has already been initiated for this order"
      );
    }
    if (method === PaymentMethod.PREPAID && isPaymentGatewayEnabled()) {
      return completeGatewayInitiation(order.id);
    }
    return toPaymentResponse(payment);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.payment.findUnique({
        where: { orderId },
        select: paymentSelect
      });
      if (existing?.method === method && existing.status === PaymentStatus.PENDING) {
        if (method === PaymentMethod.PREPAID && isPaymentGatewayEnabled()) {
          return completeGatewayInitiation(orderId);
        }
        return toPaymentResponse(existing);
      }
      throw new AppError(409, "PAYMENT_ALREADY_INITIATED", "A payment already exists for this order");
    }
    throw error;
  }
}

export async function getPatientPayment(patientId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, patientId },
    select: { id: true }
  });
  if (!order) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order was not found");
  }

  const payment = await prisma.payment.findUnique({
    where: { orderId },
    select: paymentSelect
  });
  if (!payment) {
    throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment was not found");
  }
  return toPaymentResponse(payment);
}

/**
 * Creates (or reuses) the gateway order for a PREPAID payment and returns the
 * safe public checkout payload. The amount is always derived server-side from
 * the authoritative order/payment record; the frontend never supplies it.
 */
async function completeGatewayInitiation(orderId: string) {
  const gateway = getPaymentGateway();
  const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId } });

  if (!GATEWAY_SUPPORTED_CURRENCIES.has(payment.currency)) {
    throw new AppError(409, "PAYMENT_CURRENCY_UNSUPPORTED", "Gateway payments support INR orders only");
  }
  const amountMinor = toMinorUnits(payment.amount);

  let gatewayOrderId = payment.providerOrderId;
  if (!gatewayOrderId) {
    const created = await gateway.createGatewayOrder({
      amountMinor,
      currency: payment.currency,
      receipt: orderId
    });
    gatewayOrderId = created.gatewayOrderId;
    await prisma.payment.update({
      where: { orderId },
      data: { provider: gateway.name, providerOrderId: gatewayOrderId }
    });
  }

  const refreshed = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
  return {
    ...toPaymentResponse(refreshed),
    checkout: {
      provider: gateway.name,
      keyId: gateway.publicKeyId,
      gatewayOrderId,
      amountMinor,
      currency: payment.currency,
      orderId
    }
  };
}

/**
 * Verifies a gateway checkout result server-side: signature first, then the
 * gateway-reported payment state, then conditional idempotent transitions.
 * A successful verification is the ONLY path that marks a prepaid order paid.
 */
export async function verifyPatientPayment(patientId: string, orderId: string, input: VerifyPaymentInput) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, patientId },
    select: { id: true }
  });
  if (!order) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order was not found");
  }

  const payment = await prisma.payment.findUnique({ where: { orderId } });
  if (!payment) {
    throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment was not found");
  }
  if (payment.method !== PaymentMethod.PREPAID) {
    throw new AppError(409, "PAYMENT_METHOD_CONFLICT", "Only prepaid payments are verified through the gateway");
  }
  if (!isPaymentGatewayEnabled()) {
    throw new AppError(503, "PAYMENT_GATEWAY_DISABLED", "Payment gateway is not configured");
  }
  if (payment.status === PaymentStatus.PAID) {
    return toPaymentResponse(payment); // idempotent repeat
  }
  if (payment.providerOrderId !== input.gatewayOrderId) {
    throw new AppError(400, "PAYMENT_ORDER_MISMATCH", "Gateway order does not match this payment");
  }

  const gateway = getPaymentGateway();
  gateway.verifyPaymentSignature({
    gatewayOrderId: input.gatewayOrderId,
    gatewayPaymentId: input.gatewayPaymentId,
    gatewaySignature: input.gatewaySignature
  });

  const gatewayPayment = await gateway.fetchGatewayPayment(input.gatewayPaymentId);
  if (gatewayPayment.gatewayOrderId !== input.gatewayOrderId) {
    throw new AppError(400, "PAYMENT_ORDER_MISMATCH", "Gateway payment does not belong to this gateway order");
  }
  if (gatewayPayment.currency !== payment.currency) {
    throw new AppError(409, "PAYMENT_CURRENCY_MISMATCH", "Gateway payment currency does not match the order");
  }
  if (gatewayPayment.amountMinor !== toMinorUnits(payment.amount)) {
    throw new AppError(409, "PAYMENT_AMOUNT_MISMATCH", "Gateway payment amount does not match the payable amount");
  }

  if (gatewayPayment.status === "CAPTURED") {
    const [paymentUpdate] = await prisma.$transaction([
      prisma.payment.updateMany({
        where: {
          orderId,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED, PaymentStatus.FAILED] }
        },
        data: {
          status: PaymentStatus.PAID,
          providerPaymentId: input.gatewayPaymentId,
          failureCode: null,
          failureMessage: null,
          paidAt: new Date()
        }
      }),
      prisma.order.updateMany({
        where: { id: orderId, status: OrderStatus.PENDING_PAYMENT },
        data: { status: OrderStatus.PAID }
      })
    ]);
    if (paymentUpdate.count === 0) {
      const refreshed = await prisma.payment.findUnique({ where: { orderId } });
      if (refreshed?.status === PaymentStatus.PAID) {
        return toPaymentResponse(refreshed); // concurrent verification already completed
      }
      throw new AppError(409, "PAYMENT_STATE_CONFLICT", "Payment could not be marked as paid");
    }
  } else if (gatewayPayment.status === "AUTHORIZED") {
    await prisma.payment.updateMany({
      where: { orderId, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.AUTHORIZED, providerPaymentId: input.gatewayPaymentId }
    });
  } else if (gatewayPayment.status === "FAILED") {
    await prisma.payment.updateMany({
      where: { orderId, status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED] } },
      data: {
        status: PaymentStatus.FAILED,
        providerPaymentId: input.gatewayPaymentId,
        failureCode: "GATEWAY_PAYMENT_FAILED",
        failureMessage: "The gateway reported the payment as failed"
      }
    });
  } else {
    throw new AppError(409, "PAYMENT_NOT_COMPLETED", "Gateway payment has not completed");
  }

  const refreshed = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
  return toPaymentResponse(refreshed);
}