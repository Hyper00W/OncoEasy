import { ClinicalTrialSource, ClinicalTrialStatus, Prisma, TrialInterestStatus, UserRole } from "@prisma/client";

import { prisma } from "../../database/prisma";
import { AppError } from "../../errors/app-error";
import { toInterestResponse, toTrialResponse } from "./trials.mapper";
import type { CreateInterestInput, CreateTrialInput, TrialListQuery, UpdateInterestStatusInput, UpdateTrialInput } from "./trials.schemas";
import { recordAnalyticsEvent } from "../analytics/analytics.events";

const publicSelect = {
  id: true, title: true, summary: true, description: true, source: true, sourceTrialId: true, sourceUrl: true,
  sponsor: true, location: true, status: true, eligibilitySummary: true, contactInformation: true,
  isPublished: true, publishedAt: true, createdAt: true, updatedAt: true
} as const;
const adminInclude = { createdBy: { select: { id: true, fullName: true } }, updatedBy: { select: { id: true, fullName: true } } } as const;
const interestInclude = { trial: { select: publicSelect }, patient: { select: { id: true, fullName: true } }, updatedBy: { select: { id: true, fullName: true } } } as const;

export async function listPublishedTrials(query: TrialListQuery) {
  return listTrials({ isPublished: true, ...(query.status ? { status: query.status as ClinicalTrialStatus } : {}), ...(query.search ? searchWhere(query.search) : {}) }, query, false);
}

export async function getPublishedTrial(trialId: string) {
  const trial = await prisma.clinicalTrial.findFirst({ where: { id: trialId, isPublished: true }, select: publicSelect });
  if (!trial) throw new AppError(404, "CLINICAL_TRIAL_NOT_FOUND", "Clinical trial was not found");
  return toTrialResponse(trial);
}

export async function createTrialInterest(patientId: string, trialId: string, input: CreateInterestInput) {
  await assertPatient(patientId);
  const trial = await prisma.clinicalTrial.findFirst({ where: { id: trialId, isPublished: true }, select: publicSelect });
  if (!trial) throw new AppError(404, "CLINICAL_TRIAL_NOT_FOUND", "Clinical trial was not found");
  try {
    const interest = await prisma.$transaction(async (transaction) => {
      const created = await transaction.trialInterest.create({ data: { trialId, patientId, notes: input.notes }, include: interestInclude });
      await recordAnalyticsEvent(transaction, "TRIAL_INTEREST_SUBMITTED", { userId: patientId, entityType: "TRIAL_INTEREST", entityId: created.id });
      return created;
    });
    return toInterestResponse(interest);
  } catch (error) {
    if (isCode(error, "P2002")) throw new AppError(409, "TRIAL_INTEREST_EXISTS", "You have already expressed interest in this trial");
    throw error;
  }
}

export async function listPatientInterests(patientId: string) {
  await assertPatient(patientId);
  const interests = await prisma.trialInterest.findMany({ where: { patientId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: interestInclude });
  return interests.map((interest) => toInterestResponse(interest));
}

export async function listAdminTrials(query: TrialListQuery) {
  return listTrials({ ...(query.isPublished === undefined ? {} : { isPublished: query.isPublished }), ...(query.status ? { status: query.status as ClinicalTrialStatus } : {}), ...(query.search ? searchWhere(query.search) : {}) }, query, true);
}

export async function getAdminTrial(trialId: string) {
  const trial = await prisma.clinicalTrial.findUnique({ where: { id: trialId }, include: adminInclude });
  if (!trial) throw new AppError(404, "CLINICAL_TRIAL_NOT_FOUND", "Clinical trial was not found");
  return toTrialResponse(trial, true);
}

export async function createAdminTrial(adminId: string, input: CreateTrialInput) {
  await assertAdmin(adminId);
  try {
    const trial = await prisma.clinicalTrial.create({ data: { ...input, publishedAt: input.isPublished ? new Date() : null, createdById: adminId, updatedById: adminId }, include: adminInclude });
    return toTrialResponse(trial, true);
  } catch (error) {
    throw mapTrialWriteError(error);
  }
}

export async function updateAdminTrial(adminId: string, trialId: string, input: UpdateTrialInput) {
  await assertAdmin(adminId);
  try {
    const trial = await prisma.clinicalTrial.update({ where: { id: trialId }, data: { ...input, updatedById: adminId }, include: adminInclude });
    return toTrialResponse(trial, true);
  } catch (error) {
    if (isCode(error, "P2025")) throw new AppError(404, "CLINICAL_TRIAL_NOT_FOUND", "Clinical trial was not found");
    throw mapTrialWriteError(error);
  }
}

export async function publishAdminTrial(adminId: string, trialId: string, isPublished: boolean) {
  await assertAdmin(adminId);
  try {
    const trial = await prisma.clinicalTrial.update({ where: { id: trialId }, data: { isPublished, publishedAt: isPublished ? new Date() : null, updatedById: adminId }, include: adminInclude });
    return toTrialResponse(trial, true);
  } catch (error) {
    if (isCode(error, "P2025")) throw new AppError(404, "CLINICAL_TRIAL_NOT_FOUND", "Clinical trial was not found");
    throw error;
  }
}

export async function listAdminInterests(query: { page: number; pageSize: number; status?: TrialInterestStatus; trialId?: string }) {
  const where = { ...(query.status ? { status: query.status } : {}), ...(query.trialId ? { trialId: query.trialId } : {}) };
  const skip = (query.page - 1) * query.pageSize;
  const [total, interests] = await prisma.$transaction([
    prisma.trialInterest.count({ where }),
    prisma.trialInterest.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip, take: query.pageSize, include: interestInclude })
  ]);
  return { items: interests.map((interest) => toInterestResponse(interest, true)), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
}

export async function updateInterestStatus(adminId: string, interestId: string, input: UpdateInterestStatusInput) {
  await assertAdmin(adminId);
  try {
    const interest = await prisma.trialInterest.update({ where: { id: interestId }, data: { status: input.status, updatedById: adminId }, include: interestInclude });
    return toInterestResponse(interest, true);
  } catch (error) {
    if (isCode(error, "P2025")) throw new AppError(404, "TRIAL_INTEREST_NOT_FOUND", "Trial interest was not found");
    throw error;
  }
}

function searchWhere(search: string) {
  return { OR: [{ title: { contains: search, mode: "insensitive" as const } }, { summary: { contains: search, mode: "insensitive" as const } }, { description: { contains: search, mode: "insensitive" as const } }] };
}

async function listTrials(where: Prisma.ClinicalTrialWhereInput, query: TrialListQuery, admin: boolean) {
  const skip = (query.page - 1) * query.pageSize;
  const [total, trials] = await prisma.$transaction([
    prisma.clinicalTrial.count({ where }),
    admin ? prisma.clinicalTrial.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip, take: query.pageSize, include: adminInclude }) : prisma.clinicalTrial.findMany({ where, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], skip, take: query.pageSize, select: publicSelect })
  ]);
  return { items: trials.map((trial) => toTrialResponse(trial, admin)), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
}

async function assertPatient(patientId: string) { const user = await prisma.user.findFirst({ where: { id: patientId, role: UserRole.PATIENT, isActive: true }, select: { id: true } }); if (!user) throw new AppError(403, "PATIENT_NOT_AUTHORIZED", "Patient access is not authorized"); }
async function assertAdmin(adminId: string) { const user = await prisma.user.findFirst({ where: { id: adminId, role: UserRole.OPS_ADMIN, isActive: true }, select: { id: true } }); if (!user) throw new AppError(403, "ADMIN_NOT_AUTHORIZED", "Admin access is not authorized"); }
function isCode(error: unknown, code: string) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code; }
function mapTrialWriteError(error: unknown): AppError { if (isCode(error, "P2002")) return new AppError(409, "CLINICAL_TRIAL_DUPLICATE", "A clinical trial with this source identity already exists"); return new AppError(500, "INTERNAL_SERVER_ERROR", "An unexpected error occurred"); }
