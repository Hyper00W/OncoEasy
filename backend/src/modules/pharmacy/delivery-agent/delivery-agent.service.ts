import { createHash } from "node:crypto";

import { DeliveryMode, DeliveryProofType, DeliveryStatus, OrderStatus, PaymentMethod, PaymentStatus, UserRole } from "@prisma/client";

import { prisma } from "../../../database/prisma";
import { AppError } from "../../../errors/app-error";
import { deletePrivateObject, uploadPrivateFile } from "../../../storage/private-storage";
import { toDeliveryAgentResponse } from "./delivery-agent.mapper";
import type { AdminDeliveryListQuery, AssignDeliveryInput, FailDeliveryInput, ProofType } from "./delivery-agent.schemas";
import { markReferralFulfilled } from "../../referrals/referral.service";
import { recordAnalyticsEvent } from "../../analytics/analytics.events";
import { recordAuditEvent } from "../../../observability/audit";
import { getDeliveryProvider } from "../delivery/delivery-provider-selector";

const deliveryInclude = {
  order: {
    include: {
      items: { select: { quantity: true, productNameSnapshot: true } },
      payments: { select: { method: true, status: true } }
    }
  },
  proofs: { orderBy: { createdAt: "asc" as const }, select: { id: true, type: true, documentName: true, mimeType: true, createdAt: true } }
} as const;

export async function assignLocalDelivery(deliveryId: string, input: AssignDeliveryInput, assignerId?: string, assignerRole?: string) {
  const agent = await prisma.user.findFirst({ where: { id: input.agentId, role: UserRole.DELIVERY_AGENT, isActive: true } });
  if (!agent) throw new AppError(404, "DELIVERY_AGENT_NOT_FOUND", "Delivery agent was not found");

  const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId }, include: { order: true } });
  if (!delivery) throw new AppError(404, "DELIVERY_NOT_FOUND", "Delivery was not found");
  if (delivery.mode !== DeliveryMode.LOCAL) throw new AppError(409, "COURIER_DELIVERY_NOT_SUPPORTED", "Courier deliveries cannot be assigned to local agents");
  if (delivery.status !== DeliveryStatus.PENDING) throw new AppError(409, "DELIVERY_STATE_CONFLICT", "Delivery is not awaiting assignment");

  // Shipment creation through the provider seam. Idempotent: the MANUAL_LOCAL
  // adapter records the internal delivery id as the reference; a delivery that
  // already carries a reference keeps its original one. Payment status is
  // never changed by assignment/shipment creation.
  const provider = getDeliveryProvider();
  const shipment = await provider.createShipment({
    deliveryId: delivery.id,
    orderId: delivery.orderId,
    mode: delivery.mode,
    pincode: delivery.order.deliveryPincode,
    hasColdChainItems: false
  });

  // Conditional assignment: only a delivery still PENDING is updated, so two
  // concurrent admins cannot both assign (last-write-wins silently changed the
  // agent before). A lost race surfaces as a deterministic 409.
  const assigned = await prisma.delivery.updateMany({
    where: { id: deliveryId, status: DeliveryStatus.PENDING },
    data: {
      agentId: agent.id,
      status: DeliveryStatus.ASSIGNED,
      assignedAt: new Date(),
      trackingNumber: delivery.trackingNumber ?? shipment.reference,
      courierName: delivery.courierName ?? shipment.provider
    }
  });
  if (assigned.count === 0) {
    throw new AppError(409, "DELIVERY_STATE_CONFLICT", "Delivery is not awaiting assignment");
  }
  const updated = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: deliveryInclude });

  await recordAuditEvent(prisma, {
    eventType: "DELIVERY_ASSIGNED",
    actorUserId: assignerId ?? null,
    actorRole: assignerRole ?? null,
    resourceType: "DELIVERY",
    resourceId: deliveryId,
    metadata: { agentId: agent.id }
  });

  return toDeliveryAgentResponse(updated);
}

export async function listAssignedDeliveries(agentId: string) {
  const deliveries = await prisma.delivery.findMany({
    where: { agentId, mode: DeliveryMode.LOCAL, status: { in: [DeliveryStatus.ASSIGNED, DeliveryStatus.OUT_FOR_DELIVERY, DeliveryStatus.FAILED, DeliveryStatus.DELIVERED] } },
    orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
    include: deliveryInclude
  });
  return deliveries.map(toDeliveryAgentResponse);
}

export async function getAssignedDelivery(agentId: string, deliveryId: string) {
  const delivery = await prisma.delivery.findFirst({ where: { id: deliveryId, agentId }, include: deliveryInclude });
  if (!delivery) throw new AppError(404, "DELIVERY_NOT_FOUND", "Assigned delivery was not found");
  return toDeliveryAgentResponse(delivery);
}

export async function markOutForDelivery(agentId: string, deliveryId: string) {
  return transitionAssignedDelivery(agentId, deliveryId, DeliveryStatus.ASSIGNED, {
    status: DeliveryStatus.OUT_FOR_DELIVERY,
    outForDeliveryAt: new Date()
  });
}

export async function markFailed(agentId: string, deliveryId: string, input: FailDeliveryInput) {
  return transitionAssignedDelivery(agentId, deliveryId, [DeliveryStatus.ASSIGNED, DeliveryStatus.OUT_FOR_DELIVERY], {
    status: DeliveryStatus.FAILED,
    failedAt: new Date(),
    failureReason: input.reason
  });
}

export async function markDelivered(agentId: string, deliveryId: string) {
  const delivery = await prisma.delivery.findFirst({ where: { id: deliveryId, agentId }, include: { order: { include: { payments: true } }, proofs: true } });
  if (!delivery) throw new AppError(404, "DELIVERY_NOT_FOUND", "Assigned delivery was not found");
  if (delivery.status !== DeliveryStatus.OUT_FOR_DELIVERY) throw new AppError(409, "DELIVERY_STATE_CONFLICT", "Delivery is not out for delivery");
  // Unpaid prepaid orders must never be marked delivered. COD is unaffected:
  // collection is recorded through the required COD proof (CASH_OVER_BILL or
  // ONLINE_PAYMENT), which is the existing authorized collection workflow.
  const prepaidPayment = delivery.order.payments.find((payment) => payment.method === PaymentMethod.PREPAID);
  if (prepaidPayment && prepaidPayment.status !== PaymentStatus.PAID) {
    throw new AppError(409, "PAYMENT_NOT_COMPLETE", "Prepaid payment must be complete before delivery");
  }
  requireDeliveryProof(delivery.proofs);
  if (delivery.order.payments.some((payment) => payment.method === PaymentMethod.COD)) requireCodProof(delivery.proofs);

  const updated = await prisma.$transaction(async (transaction) => {
    const result = await transaction.delivery.update({ where: { id: deliveryId }, data: { status: DeliveryStatus.DELIVERED, deliveredAt: new Date() }, include: deliveryInclude });
    // Order completion is conditional: only an order in a valid fulfillment
    // state may be marked DELIVERED, so a cancelled/regressed order can never
    // be flipped by a delivery completion. PENDING_PAYMENT is legitimate here:
    // COD orders stay unpaid (payment PENDING) until cash is collected at the
    // door; unpaid *prepaid* orders are already blocked above by the explicit
    // PAYMENT_NOT_COMPLETE check.
    const orderUpdated = await transaction.order.updateMany({
      where: { id: delivery.orderId, status: { in: [OrderStatus.PENDING_PAYMENT, OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.READY_FOR_DELIVERY, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.SHIPPED] } },
      data: { status: OrderStatus.DELIVERED }
    });
    if (orderUpdated.count === 0) {
      throw new AppError(409, "ORDER_STATE_CONFLICT", "The order is not in a deliverable state");
    }
    await recordAnalyticsEvent(transaction, "PHARMACY_ORDER_COMPLETED", { userId: delivery.order.patientId, entityType: "ORDER", entityId: delivery.orderId });
    await recordAuditEvent(transaction, {
      eventType: "DELIVERY_COMPLETED",
      actorUserId: agentId,
      actorRole: "DELIVERY_AGENT",
      resourceType: "DELIVERY",
      resourceId: deliveryId,
      metadata: { orderId: delivery.orderId }
    });
    await markReferralFulfilled(transaction, delivery.orderId);
    return result;
  });
  return toDeliveryAgentResponse(updated);
}

export async function uploadDeliveryProof(agentId: string, deliveryId: string, proofType: ProofType, file: Express.Multer.File | undefined) {
  if (!file) throw new AppError(400, "FILE_REQUIRED", "A proof file is required");
  const delivery = await prisma.delivery.findFirst({ where: { id: deliveryId, agentId }, include: { order: { include: { payments: true } } } });
  if (!delivery) throw new AppError(404, "DELIVERY_NOT_FOUND", "Assigned delivery was not found");
  if (delivery.status !== DeliveryStatus.ASSIGNED && delivery.status !== DeliveryStatus.OUT_FOR_DELIVERY) throw new AppError(409, "DELIVERY_STATE_CONFLICT", "Proof cannot be uploaded in this delivery state");
  if (proofType === "DELIVERY_PHOTO" && delivery.status !== DeliveryStatus.OUT_FOR_DELIVERY) throw new AppError(409, "DELIVERY_STATE_CONFLICT", "Delivery photo requires an out-for-delivery delivery");
  if (proofType !== "DELIVERY_PHOTO" && !delivery.order.payments.some((payment) => payment.method === PaymentMethod.COD)) throw new AppError(400, "COD_PROOF_NOT_REQUIRED", "Payment proof is only required for COD orders");

  validateProofFile(file);
  const uploaded = await uploadPrivateFile("delivery-proofs", { extension: extensionFor(file.mimetype), contentType: file.mimetype, body: file.buffer });
  try {
    // Proof creation and COD collection recording are one logical operation:
    // both succeed together or neither does. Collection is conditional on the
    // payment still being PENDING, so repeated/multiple proofs are idempotent
    // and a collected payment can never regress.
    const isCodProof = proofType === "CASH_OVER_BILL" || proofType === "ONLINE_PAYMENT";
    const proof = await prisma.$transaction(async (transaction) => {
      const created = await transaction.deliveryProof.create({ data: { deliveryId, uploadedById: agentId, type: proofType as DeliveryProofType, storageKey: uploaded.key, documentName: file.originalname, mimeType: file.mimetype, checksum: createHash("sha256").update(file.buffer).digest("hex") } });
      if (isCodProof) {
        const codPayment = await transaction.payment.findFirst({ where: { orderId: delivery.orderId, method: PaymentMethod.COD }, select: { id: true } });
        if (codPayment) {
          await transaction.payment.updateMany({ where: { id: codPayment.id, status: PaymentStatus.PENDING }, data: { status: PaymentStatus.CASH_COLLECTED, paidAt: new Date() } });
        }
      }
      return created;
    });
    return { id: proof.id, type: proof.type, documentName: proof.documentName, mimeType: proof.mimeType, createdAt: proof.createdAt.toISOString() };
  } catch (error) {
    await deletePrivateObject(uploaded.key);
    throw error;
  }
}

async function transitionAssignedDelivery(agentId: string, deliveryId: string, expected: DeliveryStatus | DeliveryStatus[], data: { status: DeliveryStatus; outForDeliveryAt?: Date; failedAt?: Date; failureReason?: string }) {
  const states = Array.isArray(expected) ? expected : [expected];
  const delivery = await prisma.delivery.updateMany({ where: { id: deliveryId, agentId, mode: DeliveryMode.LOCAL, status: { in: states } }, data });
  if (delivery.count === 0) throw new AppError(409, "DELIVERY_STATE_CONFLICT", "Delivery transition is not valid");

  if (data.status === DeliveryStatus.FAILED) {
    // Audit carries only the transition category; the free-text failure
    // reason is never copied into audit metadata.
    await recordAuditEvent(prisma, {
      eventType: "DELIVERY_FAILED",
      actorUserId: agentId,
      actorRole: "DELIVERY_AGENT",
      resourceType: "DELIVERY",
      resourceId: deliveryId
    });
  }

  const updated = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: deliveryInclude });
  return toDeliveryAgentResponse(updated);
}

function requireDeliveryProof(proofs: Array<{ type: DeliveryProofType }>) {
  if (!proofs.some((proof) => proof.type === DeliveryProofType.DELIVERY_PHOTO)) throw new AppError(400, "DELIVERY_PROOF_REQUIRED", "A delivery photo is required");
}

function requireCodProof(proofs: Array<{ type: DeliveryProofType }>) {
  if (!proofs.some((proof) => proof.type === DeliveryProofType.CASH_OVER_BILL || proof.type === DeliveryProofType.ONLINE_PAYMENT)) throw new AppError(400, "COD_PROOF_REQUIRED", "COD payment proof is required");
}

function validateProofFile(file: Express.Multer.File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) throw new AppError(400, "UNSUPPORTED_FILE_TYPE", "Proof must be a JPEG, PNG, or WEBP image");
}

function extensionFor(mimeType: string) {
  return mimeType === "image/jpeg" ? ".jpg" : mimeType === "image/png" ? ".png" : ".webp";
}

export async function listAdminDeliveries(query: AdminDeliveryListQuery) {
  const where = { ...(query.status ? { status: query.status as DeliveryStatus } : {}), ...(query.mode ? { mode: query.mode as DeliveryMode } : {}) };
  const skip = (query.page - 1) * query.pageSize;
  const [total, deliveries] = await prisma.$transaction([
    prisma.delivery.count({ where }),
    prisma.delivery.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: query.pageSize, include: deliveryInclude })
  ]);
  return { items: deliveries.map(toDeliveryAgentResponse), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
}

export async function getAdminDelivery(deliveryId: string) {
  const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId }, include: deliveryInclude });
  if (!delivery) throw new AppError(404, "DELIVERY_NOT_FOUND", "Delivery was not found");
  return toDeliveryAgentResponse(delivery);
}