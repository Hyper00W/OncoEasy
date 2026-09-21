import { DeliveryMode, DeliveryStatus, OrderStatus, Prisma } from "@prisma/client";

import { prisma } from "../../../database/prisma";
import { AppError } from "../../../errors/app-error";
import { validateCartItems } from "../carts/cart.validation";
import { resolveDeliveryServiceability } from "./delivery.serviceability";

const orderForDelivery = {
  items: {
    include: {
      product: {
        select: {
          name: true,
          price: true,
          isActive: true,
          minimumQuantity: true,
          prescriptionRequired: true,
          coldChainRequired: true
        }
      }
    }
  },
  delivery: true
} as const;

export async function setPatientDeliveryPincode(
  patientId: string,
  orderId: string,
  pincode: string
) {
  const order = await prisma.order.findFirst({ where: { id: orderId, patientId } });
  if (!order) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order was not found");
  }
  if (order.status !== OrderStatus.PENDING_PAYMENT) {
    throw new AppError(409, "ORDER_STATE_CONFLICT", "Delivery details can no longer be changed");
  }
  const updated = await prisma.order.update({ where: { id: orderId }, data: { deliveryPincode: pincode } });
  return { orderId: updated.id, deliveryPincode: updated.deliveryPincode };
}

export async function validatePatientDelivery(patientId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, patientId },
    include: orderForDelivery
  });
  if (!order) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order was not found");
  }
  if (order.status !== OrderStatus.PENDING_PAYMENT) {
    throw new AppError(409, "ORDER_STATE_CONFLICT", "Delivery can only be validated before payment");
  }
  if (!order.deliveryPincode) {
    throw new AppError(400, "DELIVERY_PINCODE_REQUIRED", "A delivery pincode is required");
  }

  const validation = validateCartItems(order.items);
  if (!validation.valid) {
    throw new AppError(409, "ORDER_VALIDATION_FAILED", "Order requires attention before delivery validation");
  }
  const characteristics = {
    hasColdChainItems: order.items.some((item) => item.product?.coldChainRequired === true),
    subtotal: order.subtotal,
    minimumColdChainQuantityValid: order.items.every(
      (item) => !item.product?.coldChainRequired || item.quantity >= item.product.minimumQuantity
    )
  };
  const serviceability = await resolveDeliveryServiceability(order.deliveryPincode, characteristics);
  const updated = await prisma.$transaction(async (transaction) => {
    const totalAmount = order.subtotal.plus(new Prisma.Decimal(serviceability.deliveryFee));
    const updatedOrder = await transaction.order.update({
      where: { id: order.id },
      data: { deliveryFee: serviceability.deliveryFee, totalAmount }
    });
    const delivery = await transaction.delivery.upsert({
      where: { orderId: order.id },
      create: { orderId: order.id, mode: serviceability.deliveryMode, status: DeliveryStatus.PENDING },
      update: { mode: serviceability.deliveryMode }
    });
    return { updatedOrder, delivery };
  });

  return {
    ...serviceability,
    orderId: updated.updatedOrder.id,
    delivery: {
      id: updated.delivery.id,
      mode: updated.delivery.mode,
      status: updated.delivery.status,
      trackingNumber: updated.delivery.trackingNumber,
      courierName: updated.delivery.courierName
    },
    totalAmount: updated.updatedOrder.totalAmount.toFixed(2)
  };
}