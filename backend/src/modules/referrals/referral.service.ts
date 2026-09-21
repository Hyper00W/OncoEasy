import { createHash, randomBytes } from "node:crypto";
import { ReferralStatus, UserRole } from "@prisma/client";

import { prisma } from "../../database/prisma";
import { AppError } from "../../errors/app-error";
import { addCartItem } from "../pharmacy/carts/cart.service";
import { toDoctorReferralResponse, toPatientReferralResponse } from "./referral.mapper";
import type { ReferralCreateInput } from "./referral.schemas";
import type { AdminReferralListQuery } from "./referral.admin.schemas";
import { recordAnalyticsEvent } from "../analytics/analytics.events";

const referralInclude = {
  doctor: { select: { id: true, fullName: true } },
  patient: { select: { id: true, fullName: true } },
  items: {
    orderBy: { createdAt: "asc" as const },
    include: { product: { select: { sku: true, name: true, unitLabel: true, price: true, currency: true } } }
  },
  order: { select: { id: true, status: true } }
} as const;

export async function createDoctorReferral(doctorId: string, input: ReferralCreateInput) {
  await assertActiveRole(doctorId, UserRole.DOCTOR, "DOCTOR_NOT_FOUND", "Doctor was not found");
  const patient = await prisma.user.findFirst({ where: { id: input.patientId, role: UserRole.PATIENT, isActive: true }, select: { id: true } });
  if (!patient) throw new AppError(404, "PATIENT_NOT_FOUND", "Patient was not found");

  const productIds = input.items.map((item) => item.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw new AppError(400, "DUPLICATE_REFERRAL_PRODUCT", "Each product may appear only once");
  }
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, isActive: true }, select: { id: true, name: true, minimumQuantity: true } });
  const productById = new Map(products.map((product) => [product.id, product]));
  for (const item of input.items) {
    const product = productById.get(item.productId);
    if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "An active product was not found");
    if (item.quantity < product.minimumQuantity) {
      throw new AppError(400, "MINIMUM_QUANTITY_NOT_MET", `Quantity must be at least ${product.minimumQuantity}`);
    }
  }

  const accessToken = randomBytes(32).toString("hex");
  const referral = await prisma.$transaction(async (transaction) => {
    const created = await transaction.referral.create({
      data: {
        doctorId,
        patientId: patient.id,
        accessTokenHash: hashAccessToken(accessToken),
        items: { create: input.items.map((item) => ({ productId: item.productId, quantity: item.quantity, productNameSnapshot: productById.get(item.productId)!.name })) }
      },
      include: referralInclude
    });
    await recordAnalyticsEvent(transaction, "REFERRAL_CREATED", { userId: doctorId, entityType: "REFERRAL", entityId: created.id });
    await recordAnalyticsEvent(transaction, "DOCTOR_REFERRAL_CREATED", { userId: doctorId, entityType: "REFERRAL", entityId: created.id });
    return created;
  });
  return { ...toDoctorReferralResponse(referral), accessToken };
}

export async function listDoctorReferrals(doctorId: string) {
  await assertActiveRole(doctorId, UserRole.DOCTOR, "DOCTOR_NOT_FOUND", "Doctor was not found");
  const referrals = await prisma.referral.findMany({ where: { doctorId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: referralInclude });
  return referrals.map(toDoctorReferralResponse);
}

export async function getDoctorReferral(doctorId: string, referralId: string) {
  await assertActiveRole(doctorId, UserRole.DOCTOR, "DOCTOR_NOT_FOUND", "Doctor was not found");
  const referral = await prisma.referral.findFirst({ where: { id: referralId, doctorId }, include: referralInclude });
  if (!referral) throw new AppError(404, "REFERRAL_NOT_FOUND", "Referral was not found");
  return toDoctorReferralResponse(referral);
}

export async function listAdminReferrals(query: AdminReferralListQuery) {
  const where = query.status ? { status: query.status as ReferralStatus } : {};
  const skip = (query.page - 1) * query.pageSize;
  const [total, referrals] = await prisma.$transaction([
    prisma.referral.count({ where }),
    prisma.referral.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: query.pageSize, include: referralInclude })
  ]);
  return {
    items: referrals.map(toDoctorReferralResponse),
    pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) }
  };
}

export async function getAdminReferral(referralId: string) {
  const referral = await prisma.referral.findUnique({ where: { id: referralId }, include: referralInclude });
  if (!referral) throw new AppError(404, "REFERRAL_NOT_FOUND", "Referral was not found");
  return toDoctorReferralResponse(referral);
}

export async function getPatientReferral(patientId: string, accessToken: string) {
  const referral = await findPatientReferral(patientId, accessToken);
  if (referral.status === ReferralStatus.SENT) {
    await prisma.referral.updateMany({ where: { id: referral.id, patientId, status: ReferralStatus.SENT }, data: { status: ReferralStatus.VIEWED, viewedAt: new Date() } });
  }
  const refreshed = await prisma.referral.findUniqueOrThrow({ where: { id: referral.id }, include: referralInclude });
  return toPatientReferralResponse(refreshed);
}

export async function addReferralToPatientCart(patientId: string, accessToken: string) {
  const referral = await findPatientReferral(patientId, accessToken);
  if (referral.status === ReferralStatus.ORDERED || referral.status === ReferralStatus.FULFILLED) {
    throw new AppError(409, "REFERRAL_STATE_CONFLICT", "Referral has already been ordered");
  }
  if (referral.status === ReferralStatus.SENT) {
    await prisma.referral.updateMany({ where: { id: referral.id, status: ReferralStatus.SENT }, data: { status: ReferralStatus.VIEWED, viewedAt: new Date() } });
  }
  for (const item of referral.items) {
    await addCartItem(patientId, { productId: item.productId, quantity: item.quantity });
  }
  return getPatientReferral(patientId, accessToken);
}

export async function findReferralForOrder(transaction: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], patientId: string, accessToken: string) {
  const referral = await transaction.referral.findFirst({ where: { patientId, accessTokenHash: hashAccessToken(accessToken) }, include: { items: true } });
  if (!referral) throw new AppError(404, "REFERRAL_NOT_FOUND", "Referral was not found");
  if (referral.status !== ReferralStatus.VIEWED) throw new AppError(409, "REFERRAL_STATE_CONFLICT", "Referral must be viewed before ordering");
  return referral;
}

export async function markReferralOrdered(transaction: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], referralId: string) {
  const updated = await transaction.referral.updateMany({ where: { id: referralId, status: ReferralStatus.VIEWED }, data: { status: ReferralStatus.ORDERED, orderedAt: new Date() } });
  if (updated.count !== 1) throw new AppError(409, "REFERRAL_STATE_CONFLICT", "Referral is no longer available for ordering");
  await recordAnalyticsEvent(transaction, "REFERRAL_ORDERED", { entityType: "REFERRAL", entityId: referralId });
}

export async function markReferralFulfilled(transaction: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], orderId: string) {
  const referral = await transaction.referral.findFirst({ where: { order: { id: orderId }, status: ReferralStatus.ORDERED }, select: { id: true } });
  if (!referral) return;
  await transaction.referral.update({ where: { id: referral.id }, data: { status: ReferralStatus.FULFILLED, fulfilledAt: new Date() } });
  await recordAnalyticsEvent(transaction, "REFERRAL_FULFILLED", { entityType: "REFERRAL", entityId: referral.id });
}

async function findPatientReferral(patientId: string, accessToken: string) {
  const referral = await prisma.referral.findFirst({ where: { patientId, accessTokenHash: hashAccessToken(accessToken) }, include: { doctor: { select: { id: true, fullName: true } }, items: { orderBy: { createdAt: "asc" }, include: { product: { select: { sku: true, name: true, unitLabel: true, price: true, currency: true } } } }, order: { select: { id: true, status: true } } } });
  if (!referral) throw new AppError(404, "REFERRAL_NOT_FOUND", "Referral was not found");
  return referral;
}

async function assertActiveRole(userId: string, role: UserRole, code: string, message: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, role, isActive: true }, select: { id: true } });
  if (!user) throw new AppError(403, code, message);
}

function hashAccessToken(accessToken: string) {
  return createHash("sha256").update(accessToken).digest("hex");
}
