import { JourneyStageKey, Prisma, UserRole } from "@prisma/client";

import { prisma } from "../../database/prisma";
import { AppError } from "../../errors/app-error";
import { toJourneyHistoryResponse, toJourneyStageResponse } from "./journey.mapper";
import type { UpdateJourneyContentInput } from "./journey.schemas";

const stageSelect = {
  key: true,
  order: true,
  title: true,
  description: true,
  checklist: true,
  isActive: true,
  createdAt: true,
  updatedAt: true
} as const;

const journeyInclude = {
  stage: { select: stageSelect },
  history: { select: { fromStage: true, toStage: true, changedAt: true }, orderBy: { changedAt: "asc" as const } }
} as const;

const stageOrder: Record<JourneyStageKey, number> = {
  [JourneyStageKey.DIAGNOSED]: 1,
  [JourneyStageKey.TREATMENT_PLANNING]: 2,
  [JourneyStageKey.ACTIVE_TREATMENT]: 3,
  [JourneyStageKey.FOLLOW_UP]: 4
};

export async function getPatientJourney(patientId: string) {
  await assertPatient(patientId);
  const journey = await getOrCreateJourney(patientId);
  const stages = await prisma.journeyStage.findMany({ where: { isActive: true }, orderBy: [{ order: "asc" }, { key: "asc" }], select: stageSelect });
  const currentStage = journey.stage.isActive ? journey.stage : null;
  const checklist = Array.isArray(currentStage?.checklist) ? currentStage.checklist : [];

  return {
    journeyId: journey.id,
    currentStage: currentStage ? toJourneyStageResponse(currentStage) : null,
    currentStageKey: journey.currentStage,
    stages: stages.map(toJourneyStageResponse),
    checklistProgress: { completed: 0, total: checklist.length },
    history: journey.history.map(toJourneyHistoryResponse),
    updatedAt: journey.updatedAt.toISOString()
  };
}

export async function getPatientJourneyStage(patientId: string, stage: JourneyStageKey) {
  await assertPatient(patientId);
  const content = await getActiveStage(stage);
  return toJourneyStageResponse(content);
}

export async function advancePatientJourney(patientId: string, nextStage: JourneyStageKey) {
  await assertPatient(patientId);
  const journey = await getOrCreateJourney(patientId);
  const currentOrder = stageOrder[journey.currentStage];
  const nextOrder = stageOrder[nextStage];

  if (nextOrder !== currentOrder + 1) {
    throw new AppError(409, "JOURNEY_STAGE_TRANSITION_INVALID", "Journey can only advance to the next stage");
  }

  const targetStage = await getActiveStage(nextStage);
  await prisma.$transaction(async (transaction) => {
    await transaction.patientJourney.update({
      where: { id: journey.id },
      data: { currentStage: nextStage }
    });
    await transaction.patientJourneyStageHistory.create({
      data: { patientJourneyId: journey.id, fromStage: journey.currentStage, toStage: nextStage }
    });
  });
  const updated = await prisma.patientJourney.findUniqueOrThrow({ where: { id: journey.id }, include: journeyInclude });

  return {
    journeyId: updated.id,
    currentStage: toJourneyStageResponse(targetStage),
    currentStageKey: updated.currentStage,
    history: updated.history.map(toJourneyHistoryResponse),
    updatedAt: updated.updatedAt.toISOString()
  };
}

export async function listAdminJourneyStages() {
  const stages = await prisma.journeyStage.findMany({ orderBy: [{ order: "asc" }, { key: "asc" }], select: stageSelect });
  return stages.map(toJourneyStageResponse);
}

export async function getAdminJourneyStage(stage: JourneyStageKey) {
  const content = await prisma.journeyStage.findUnique({ where: { key: stage }, select: stageSelect });
  if (!content) throw new AppError(404, "JOURNEY_STAGE_NOT_FOUND", "Journey stage was not found");
  return toJourneyStageResponse(content);
}

export async function updateAdminJourneyStage(stage: JourneyStageKey, input: UpdateJourneyContentInput) {
  const existing = await prisma.journeyStage.findUnique({ where: { key: stage }, select: { key: true } });
  if (!existing) throw new AppError(404, "JOURNEY_STAGE_NOT_FOUND", "Journey stage was not found");

  const updated = await prisma.journeyStage.update({
    where: { key: stage },
    data: {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.checklist === undefined ? {} : { checklist: input.checklist as Prisma.InputJsonValue }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive })
    },
    select: stageSelect
  });
  return toJourneyStageResponse(updated);
}

async function getOrCreateJourney(patientId: string) {
  return prisma.patientJourney.upsert({
    where: { patientId },
    update: {},
    create: { patientId, currentStage: JourneyStageKey.DIAGNOSED },
    include: journeyInclude
  });
}

async function getActiveStage(stage: JourneyStageKey) {
  const content = await prisma.journeyStage.findFirst({ where: { key: stage, isActive: true }, select: stageSelect });
  if (!content) throw new AppError(404, "JOURNEY_STAGE_NOT_FOUND", "Journey stage was not found or is inactive");
  return content;
}

async function assertPatient(patientId: string) {
  const patient = await prisma.user.findFirst({ where: { id: patientId, role: UserRole.PATIENT, isActive: true }, select: { id: true } });
  if (!patient) throw new AppError(403, "PATIENT_NOT_AUTHORIZED", "Patient access is not authorized");
}
