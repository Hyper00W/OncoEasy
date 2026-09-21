import { DeliveryMode } from "@prisma/client";

/**
 * Provider-agnostic seam for delivery fulfilment.
 *
 * OncoEasy fulfils deliveries through a MANUAL/LOCAL workflow during beta:
 * Ops assigns a local delivery agent who carries the order through the
 * existing status lifecycle. No official courier API contract or credentials
 * exist in this repository, so NO adapter in this file performs any network
 * call. A future official courier adapter can implement the same interface
 * without changing the order lifecycle, patient UI, delivery-agent UI, admin
 * UI, or payment logic.
 */

export const DELIVERY_PROVIDER_MODES = ["MANUAL_LOCAL"] as const;
export type DeliveryProviderMode = (typeof DELIVERY_PROVIDER_MODES)[number];

export type ShipmentRequest = {
  deliveryId: string;
  orderId: string;
  mode: DeliveryMode;
  /** Pincode of the delivery destination (operationally necessary; no street address). */
  pincode: string | null;
  hasColdChainItems: boolean;
};

export type ShipmentResult = {
  provider: string;
  mode: DeliveryProviderMode;
  /** Provider-neutral shipment reference; stored in deliveries.tracking_number. */
  reference: string | null;
};

export interface DeliveryProvider {
  readonly provider: string;
  readonly mode: DeliveryProviderMode;

  /**
   * Create/record a shipment for a delivery. Implementations must be
   * idempotent: repeated calls for the same delivery must not create
   * duplicate shipments.
   */
  createShipment(request: ShipmentRequest): Promise<ShipmentResult>;
}

/**
 * MANUAL_LOCAL adapter: there is no external system — the internal delivery
 * record IS the shipment. Returns the internal delivery id as the reference
 * so admins/agents always have a consistent reference shape.
 */
export class ManualLocalDeliveryProvider implements DeliveryProvider {
  readonly provider = "MANUAL_LOCAL";
  readonly mode: DeliveryProviderMode = "MANUAL_LOCAL";

  async createShipment(request: ShipmentRequest): Promise<ShipmentResult> {
    // Deliberately no HTTP call: there is no official courier API in scope.
    return { provider: this.provider, mode: this.mode, reference: request.deliveryId };
  }
}

/** Deterministic in-memory adapter for tests. Never selected in production. */
export class MockDeliveryProvider implements DeliveryProvider {
  readonly provider = "MOCK_DELIVERY_PROVIDER";
  readonly mode: DeliveryProviderMode = "MANUAL_LOCAL";
  readonly createdShipments: ShipmentRequest[] = [];
  nextReference = "MOCK-SHP-1";

  async createShipment(request: ShipmentRequest): Promise<ShipmentResult> {
    this.createdShipments.push(request);
    return { provider: this.provider, mode: this.mode, reference: this.nextReference };
  }
}
