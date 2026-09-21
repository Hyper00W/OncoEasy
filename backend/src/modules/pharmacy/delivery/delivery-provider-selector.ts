import { DeliveryProvider, ManualLocalDeliveryProvider } from "./delivery-provider";

/**
 * Process-wide delivery provider. Only MANUAL_LOCAL exists today; a future
 * official courier adapter would be selected here from configuration without
 * touching the order lifecycle, agent/admin UI, or payment logic.
 */
let activeProvider: DeliveryProvider = new ManualLocalDeliveryProvider();

export function getDeliveryProvider(): DeliveryProvider {
  return activeProvider;
}

/** Test-only seam. */
export function setDeliveryProvider(provider: DeliveryProvider): void {
  activeProvider = provider;
}

/** Test-only seam. */
export function resetDeliveryProvider(): void {
  activeProvider = new ManualLocalDeliveryProvider();
}
