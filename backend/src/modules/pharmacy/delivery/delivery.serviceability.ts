import { DeliveryMode, Prisma } from "@prisma/client";

import { prisma } from "../../../database/prisma";
import { AppError } from "../../../errors/app-error";

export type DeliveryCharacteristics = {
  hasColdChainItems: boolean;
  subtotal: Prisma.Decimal;
  minimumColdChainQuantityValid: boolean;
};

export async function resolveDeliveryServiceability(
  pincode: string,
  characteristics: DeliveryCharacteristics
) {
  const configuration = await prisma.deliveryPincode.findFirst({
    where: { pincode, isActive: true }
  });

  if (!configuration) {
    throw new AppError(409, "DELIVERY_NOT_SERVICEABLE", "Delivery is unavailable for this pincode");
  }
  if (!characteristics.minimumColdChainQuantityValid) {
    throw new AppError(400, "MINIMUM_QUANTITY_NOT_MET", "Cold-chain quantity minimum was not met");
  }
  if (characteristics.hasColdChainItems && !configuration.coldChainEligible) {
    throw new AppError(409, "COLD_CHAIN_NOT_SERVICEABLE", "Cold-chain delivery is unavailable for this pincode");
  }

  const mode = configuration.localDeliveryEligible
    ? DeliveryMode.LOCAL
    : configuration.courierDeliveryEligible
      ? DeliveryMode.COURIER
      : null;
  if (!mode) {
    throw new AppError(409, "DELIVERY_NOT_SERVICEABLE", "Delivery is unavailable for this pincode");
  }

  const policyType = characteristics.hasColdChainItems ? "COLD_CHAIN" : "REGULAR";
  const policy = await prisma.deliveryPolicy.findFirst({
    where: { type: policyType, isActive: true }
  });
  if (!policy) {
    throw new AppError(503, "DELIVERY_POLICY_NOT_CONFIGURED", "Delivery pricing is not configured");
  }

  const freeDeliveryEligible = characteristics.subtotal.gte(
    policy.minimumOrderValueForFreeDelivery
  );
  const deliveryFee = freeDeliveryEligible ? new Prisma.Decimal(0) : policy.deliveryFee;

  return {
    pincode,
    serviceable: true,
    deliveryMode: mode,
    localDeliveryAvailable: configuration.localDeliveryEligible,
    courierDeliveryAvailable: configuration.courierDeliveryEligible,
    coldChainAvailable: configuration.coldChainEligible,
    codAvailable: configuration.codEligible,
    deliveryFee: deliveryFee.toFixed(2),
    freeDeliveryEligible,
    minimumOrderValueForFreeDelivery: policy.minimumOrderValueForFreeDelivery.toFixed(2),
    policyType
  };
}