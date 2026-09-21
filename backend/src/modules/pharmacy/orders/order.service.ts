import { OrderOriginType, OrderStatus, PrescriptionStatus, Prisma } from "@prisma/client";

import { prisma } from "../../../database/prisma";
import { AppError } from "../../../errors/app-error";
import { validateCartItems } from "../carts/cart.validation";
import type { AdminOrderListQuery, CreateOrderInput } from "./order.schemas";
import { toOrderResponse } from "./order.mapper";
import { findReferralForOrder, markReferralOrdered } from "../../referrals/referral.service";

const orderInclude = {
  items: { orderBy: { createdAt: "asc" as const } }
} as const;

const adminOrderInclude = {
  items: { orderBy: { createdAt: "asc" as const } },
  patient: { select: { id: true, fullName: true } },
  payments: { select: { method: true, status: true, amount: true, currency: true } },
  delivery: { select: { id: true, mode: true, status: true, agentId: true } }
} as const;

const cartInclude = {
  items: {
    orderBy: { createdAt: "asc" as const },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          price: true,
          isActive: true,
          minimumQuantity: true,
          prescriptionRequired: true
        }
      }
    }
  }
} as const;

export async function createPatientOrder(patientId: string, input: CreateOrderInput) {
  try {
    const order = await prisma.$transaction(async (transaction) => {
    const referral = input.referralToken
      ? await findReferralForOrder(transaction, patientId, input.referralToken)
      : null;
    const cart = await transaction.cart.findFirst({
      where: { patientId, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      include: cartInclude
    });

    if (!cart) {
      throw new AppError(404, "CART_NOT_FOUND", "Active cart was not found");
    }
    if (cart.items.length === 0) {
      throw new AppError(400, "CART_EMPTY", "Active cart is empty");
    }

    const validation = validateCartItems(cart.items);
    if (!validation.valid) {
      throw new AppError(409, "CART_VALIDATION_FAILED", "Cart requires attention before ordering");
    }

    const hasPrescriptionItems = cart.items.some((item) => item.product?.prescriptionRequired === true);
    let prescriptionId: string | null = null;
    let status = OrderStatus.PENDING_PAYMENT;
    if (referral) {
      for (const referralItem of referral.items) {
        const cartItem = cart.items.find((item) => item.productId === referralItem.productId);
        if (!cartItem || cartItem.quantity < referralItem.quantity) {
          throw new AppError(409, "REFERRAL_ITEMS_NOT_IN_CART", "Referred medicines must be added to the cart before ordering");
        }
      }
    }

    if (hasPrescriptionItems) {
      if (!input.prescriptionId) {
        throw new AppError(400, "PRESCRIPTION_REQUIRED", "A verified prescription is required");
      }

      const prescription = await transaction.prescription.findFirst({
        where: { id: input.prescriptionId, patientId }
      });
      if (!prescription) {
        throw new AppError(404, "PRESCRIPTION_NOT_FOUND", "Prescription was not found");
      }
      if (prescription.status !== PrescriptionStatus.VERIFIED) {
        throw new AppError(409, "PRESCRIPTION_NOT_VERIFIED", "Prescription must be verified before ordering");
      }
      prescriptionId = prescription.id;
    }

    const subtotal = cart.items.reduce(
      (total, item) => total.plus(new Prisma.Decimal(item.product!.price.toString()).mul(item.quantity)),
      new Prisma.Decimal(0)
    );
    const deliveryFee = new Prisma.Decimal(0);

    const order = await transaction.order.create({
      data: {
        patientId,
        cartId: cart.id,
        prescriptionId,
        referralId: referral?.id ?? null,
        originType: referral ? OrderOriginType.REFERRAL : OrderOriginType.DIRECT_CART,
        status,
        currency: cart.currency,
        subtotal,
        deliveryFee,
        totalAmount: subtotal.plus(deliveryFee),
        deliveryPincode: input.deliveryPincode ?? null,
        items: {
          create: cart.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPriceSnapshot: item.product!.price,
            productNameSnapshot: item.product!.name
          }))
        }
      },
      include: orderInclude
    });

    const converted = await transaction.cart.updateMany({
      where: { id: cart.id, patientId, status: "ACTIVE" },
      data: { status: "CONVERTED" }
    });
    if (converted.count !== 1) {
      throw new AppError(409, "CART_CONVERSION_CONFLICT", "Cart was already converted");
    }

    if (referral) {
      await markReferralOrdered(transaction, referral.id);
    }

    return order;
    });

    return toOrderResponse(order);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(409, "CART_CONVERSION_CONFLICT", "Cart was already converted");
    }
    throw error;
  }
}

export async function listPatientOrders(patientId: string) {
  const orders = await prisma.order.findMany({
    where: { patientId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: orderInclude
  });
  return orders.map(toOrderResponse);
}

export async function getPatientOrder(patientId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, patientId },
    include: orderInclude
  });
  if (!order) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order was not found");
  }
  return toOrderResponse(order);
}

export async function listAdminOrders(query: AdminOrderListQuery) {
  const where = query.status ? { status: query.status as OrderStatus } : {};
  const skip = (query.page - 1) * query.pageSize;
  const [total, orders] = await prisma.$transaction([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: query.pageSize, include: adminOrderInclude })
  ]);
  return { items: orders.map(toAdminOrderResponse), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
}

export async function getAdminOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: adminOrderInclude });
  if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Order was not found");
  return toAdminOrderResponse(order);
}

function toAdminOrderResponse(order: {
  id: string;
  status: string;
  originType: string;
  currency: string;
  subtotal: Prisma.Decimal;
  deliveryFee: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  deliveryPincode: string | null;
  prescriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  patient: { id: string; fullName: string };
  items: Array<{ id: string; productId: string; quantity: number; unitPriceSnapshot: Prisma.Decimal; productNameSnapshot: string }>;
  payments: Array<{ method: string; status: string; amount: Prisma.Decimal; currency: string }>;
  delivery: { id: string; mode: string; status: string; agentId: string | null } | null;
}) {
  return {
    ...toOrderResponse(order),
    patient: { patientId: order.patient.id, fullName: order.patient.fullName },
    payments: order.payments.map((payment) => ({ method: payment.method, status: payment.status, amount: payment.amount.toFixed(2), currency: payment.currency })),
    delivery: order.delivery
  };
}