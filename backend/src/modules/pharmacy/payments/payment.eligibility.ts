import { PaymentMethod } from "@prisma/client";

import { prisma } from "../../../database/prisma";
import { AppError } from "../../../errors/app-error";

export async function assertPaymentMethodEligible(
  orderId: string,
  method: PaymentMethod
) {
  if (method === PaymentMethod.PREPAID) {
    return;
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { deliveryPincode: true }
  });
  if (!order?.deliveryPincode) {
    throw new AppError(
      409,
      "COD_NOT_AVAILABLE_FOR_PINCODE",
      "COD is unavailable because no delivery pincode is configured"
    );
  }

  const pincode = await prisma.deliveryPincode.findFirst({
    where: {
      pincode: order.deliveryPincode,
      isActive: true,
      codEligible: true
    }
  });
  if (!pincode) {
    throw new AppError(
      409,
      "COD_NOT_AVAILABLE_FOR_PINCODE",
      "COD is unavailable for this delivery pincode"
    );
  }
}