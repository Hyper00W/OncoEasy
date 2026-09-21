import { LabBookingProvider, ThyrocareDsaAdapter } from "./thyrocare-dsa";

/**
 * Process-wide lab booking provider. Only the MANUAL_DSA Thyrocare adapter
 * exists today; a future official-API adapter would be selected here from
 * configuration without touching the Ops workflow or patient booking logic.
 */
let activeProvider: LabBookingProvider = new ThyrocareDsaAdapter();

export function getLabBookingProvider(): LabBookingProvider {
  return activeProvider;
}

/** Test-only seam. */
export function setLabBookingProvider(provider: LabBookingProvider): void {
  activeProvider = provider;
}

/** Test-only seam. */
export function resetLabBookingProvider(): void {
  activeProvider = new ThyrocareDsaAdapter();
}
