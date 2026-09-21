import { LabBookingStatus } from "@prisma/client";

/**
 * Provider-agnostic seam for the external lab booking provider.
 *
 * OncoEasy performs external lab booking through Thyrocare via a MANUAL DSA
 * (diagnostic service agent) workflow during beta: Ops books the collection
 * manually in the Thyrocare DSA portal and records the resulting order
 * reference here. No official Thyrocare API contract or credentials exist in
 * this repository, so NO adapter in this file performs any network call.
 *
 * A future official-API adapter can implement the same interface without
 * changing patient-facing booking logic or the Ops workflow above it.
 */

export const LAB_PROVIDER_MODES = ["MANUAL_DSA"] as const;
export type LabProviderMode = (typeof LAB_PROVIDER_MODES)[number];

export type ExternalBookingRequest = {
  bookingId: string;
  collectionType: "HOME" | "CENTER";
  preferredDate: string;
  preferredTimeSlot: string | null;
};

export type ExternalBookingResult = {
  provider: string;
  mode: LabProviderMode;
  externalOrderId: string;
};

export type ExternalStatusUpdate = {
  bookingId: string;
  externalOrderId: string;
  status: LabBookingStatus;
};

export type ExternalStatusResult = {
  provider: string;
  mode: LabProviderMode;
  accepted: boolean;
};

export interface LabBookingProvider {
  readonly provider: string;
  readonly mode: LabProviderMode;
  createExternalBooking(request: ExternalBookingRequest): Promise<ExternalBookingResult>;
  pushExternalStatus(update: ExternalStatusUpdate): Promise<ExternalStatusResult>;
}

/**
 * MANUAL_DSA adapter: the human Ops step IS the integration. `createExternalBooking`
 * records the order reference an operator obtained from the Thyrocare DSA portal;
 * `pushExternalStatus` is always accepted (Ops is the source of truth) so the
 * workflow never blocks on an external system.
 */
export class ThyrocareDsaAdapter implements LabBookingProvider {
  readonly provider = "THYROCARE";
  readonly mode: LabProviderMode = "MANUAL_DSA";

  async createExternalBooking(request: ExternalBookingRequest): Promise<ExternalBookingResult> {
    // Deliberately no HTTP call: there is no official Thyrocare API in scope.
    // The reference is supplied by the Ops operator after booking in the DSA portal.
    return { provider: this.provider, mode: this.mode, externalOrderId: request.bookingId };
  }

  async pushExternalStatus(_update: ExternalStatusUpdate): Promise<ExternalStatusResult> {
    return { provider: this.provider, mode: this.mode, accepted: true };
  }
}

/** Deterministic in-memory adapter for tests. Never selected in production. */
export class MockLabBookingProvider implements LabBookingProvider {
  readonly provider = "MOCK_LAB_PROVIDER";
  readonly mode: LabProviderMode = "MANUAL_DSA";
  readonly createdBookings: ExternalBookingRequest[] = [];
  readonly statusUpdates: ExternalStatusUpdate[] = [];
  nextExternalOrderId = "MOCK-EXT-1";

  async createExternalBooking(request: ExternalBookingRequest): Promise<ExternalBookingResult> {
    this.createdBookings.push(request);
    return { provider: this.provider, mode: this.mode, externalOrderId: this.nextExternalOrderId };
  }

  async pushExternalStatus(update: ExternalStatusUpdate): Promise<ExternalStatusResult> {
    this.statusUpdates.push(update);
    return { provider: this.provider, mode: this.mode, accepted: true };
  }
}
