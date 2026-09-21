import { ChatIntent, ChatMessageSender, ChatSessionStatus, UserRole } from "@prisma/client";

import { prisma } from "../../database/prisma";
import { AppError } from "../../errors/app-error";
import type { AdminSessionListQuery } from "./chat.schemas";

const routeByIntent: Record<ChatIntent, string | null> = {
  PHARMACY: "/patient/pharmacy",
  DOCTOR_CONSULT: "/patient/consultations",
  LABS: "/patient/labs",
  PAP: "/patient/pap",
  CARE_JOURNEY: "/patient/journey",
  KNOWLEDGE: "/patient/knowledge",
  CLINICAL_TRIALS: "/patient/trials",
  HUMAN_SUPPORT: "HUMAN_SUPPORT_ESCALATION",
  GENERAL: null
};

const keywordRules: Array<{ intent: ChatIntent; pattern: RegExp }> = [
  { intent: ChatIntent.PHARMACY, pattern: /\b(medicine|order|pharmacy|prescription)\b/i },
  { intent: ChatIntent.DOCTOR_CONSULT, pattern: /\b(doctor|appointment|consultation|book doctor)\b/i },
  { intent: ChatIntent.LABS, pattern: /\b(test|blood test|lab|scan|report)\b/i },
  { intent: ChatIntent.PAP, pattern: /\b(financial assistance|patient assistance|pap|assistance program)\b/i },
  { intent: ChatIntent.CARE_JOURNEY, pattern: /\b(journey|treatment stage|next step)\b/i },
  { intent: ChatIntent.KNOWLEDGE, pattern: /\b(article|learn|information|research)\b/i },
  { intent: ChatIntent.CLINICAL_TRIALS, pattern: /\b(clinical trial|trial|study)\b/i },
  { intent: ChatIntent.HUMAN_SUPPORT, pattern: /\b(support|representative|agent|contact someone)\b/i }
];

const medicalRequestPattern = /\b(diagnos(?:e|is)|symptoms?|what medicine should i take|dosage|dose|treatment recommendation|what should i do medically)\b/i;

const sessionInclude = { messages: { orderBy: { createdAt: "asc" as const } } } as const;

export async function createSession(patientId: string) {
  await assertPatient(patientId);
  return toSession(await prisma.chatSession.create({ data: { patientId }, include: sessionInclude }));
}

export async function listPatientSessions(patientId: string) {
  await assertPatient(patientId);
  const sessions = await prisma.chatSession.findMany({ where: { patientId }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], include: sessionInclude });
  return sessions.map(toSession);
}

export async function getPatientSession(patientId: string, sessionId: string) {
  await assertPatient(patientId);
  const session = await prisma.chatSession.findFirst({ where: { id: sessionId, patientId }, include: sessionInclude });
  if (!session) throw new AppError(404, "CHAT_SESSION_NOT_FOUND", "Chat session was not found");
  return toSession(session);
}

export async function addPatientMessage(patientId: string, sessionId: string, content: string) {
  await assertPatient(patientId);
  const session = await prisma.chatSession.findFirst({ where: { id: sessionId, patientId }, select: { id: true, status: true } });
  if (!session) throw new AppError(404, "CHAT_SESSION_NOT_FOUND", "Chat session was not found");
  if (session.status === ChatSessionStatus.CLOSED) throw new AppError(409, "CHAT_SESSION_CLOSED", "This chat session is closed");

  const intent = classifyIntent(content);
  const escalated = intent === ChatIntent.HUMAN_SUPPORT;
  const responseContent = responseFor(intent);
  const updated = await prisma.$transaction(async (transaction) => {
    await transaction.chatMessage.create({ data: { sessionId, sender: ChatMessageSender.PATIENT, content, intent } });
    await transaction.chatMessage.create({ data: { sessionId, sender: ChatMessageSender.ROUTER, content: responseContent, intent } });
    return transaction.chatSession.update({
      where: { id: sessionId },
      data: { intent, escalated: session.status === ChatSessionStatus.ESCALATED || escalated, status: escalated ? ChatSessionStatus.ESCALATED : session.status },
      include: sessionInclude
    });
  });
  return { detectedIntent: intent, response: responseContent, route: routeByIntent[intent], escalated: updated.escalated, session: toSession(updated) };
}

export async function listAdminSessions(query: AdminSessionListQuery) {
  const where = { ...(query.escalated === undefined ? {} : { escalated: query.escalated }), ...(query.status ? { status: query.status as ChatSessionStatus } : {}) };
  const skip = (query.page - 1) * query.pageSize;
  const [total, sessions] = await prisma.$transaction([
    prisma.chatSession.count({ where }),
    prisma.chatSession.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip, take: query.pageSize, include: sessionInclude })
  ]);
  return { items: sessions.map(toSession), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
}

export async function getAdminSession(sessionId: string) {
  const session = await prisma.chatSession.findUnique({ where: { id: sessionId }, include: sessionInclude });
  if (!session) throw new AppError(404, "CHAT_SESSION_NOT_FOUND", "Chat session was not found");
  return toSession(session);
}

export function classifyIntent(content: string): ChatIntent {
  if (medicalRequestPattern.test(content)) return ChatIntent.HUMAN_SUPPORT;
  return keywordRules.find((rule) => rule.pattern.test(content))?.intent ?? ChatIntent.GENERAL;
}

function responseFor(intent: ChatIntent): string {
  if (intent === ChatIntent.HUMAN_SUPPORT) return "I cannot provide medical advice. Your request has been flagged for human support follow-up; a support professional has not responded yet.";
  if (intent === ChatIntent.GENERAL) return "I can help you find OncoEasy features such as pharmacy, doctor consultations, labs, PAP assistance, care journey, knowledge, clinical trials, or human support.";
  return `I can help you navigate to ${intent.toLowerCase().replaceAll("_", " ")}.`;
}

function toSession(session: { id: string; patientId: string; status: ChatSessionStatus; intent: ChatIntent; escalated: boolean; createdAt: Date; updatedAt: Date; closedAt: Date | null; messages: Array<{ id: string; sender: ChatMessageSender; content: string; intent: ChatIntent | null; createdAt: Date }> }) {
  return {
    sessionId: session.id,
    patientId: session.patientId,
    status: session.status,
    intent: session.intent,
    escalated: session.escalated,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    closedAt: session.closedAt?.toISOString() ?? null,
    messages: session.messages.map((message) => ({ messageId: message.id, sender: message.sender, content: message.content, intent: message.intent, createdAt: message.createdAt.toISOString() }))
  };
}

async function assertPatient(patientId: string) {
  const patient = await prisma.user.findFirst({ where: { id: patientId, role: UserRole.PATIENT, isActive: true }, select: { id: true } });
  if (!patient) throw new AppError(403, "PATIENT_NOT_AUTHORIZED", "Patient access is not authorized");
}