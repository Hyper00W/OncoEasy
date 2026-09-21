import { AnalyticsEventName, LabBookingStatus, OrderStatus, PapApplicationStatus, PrescriptionStatus, ReferralStatus, PatientStoryStatus } from "@prisma/client";

import { prisma } from "../../database/prisma";
import type { AnalyticsDateRange, AnalyticsEventsQuery } from "./analytics.schemas";

function rangeWhere(range: AnalyticsDateRange, field: "createdAt" | "updatedAt" = "createdAt") {
  return range.from || range.to ? { [field]: { ...(range.from ? { gte: new Date(range.from) } : {}), ...(range.to ? { lte: new Date(range.to) } : {}) } } : {};
}

export async function getAnalyticsOverview(range: AnalyticsDateRange) {
  const createdRange = rangeWhere(range);
  const [
    referralsCreated,
    referralsConverted,
    consultationModes,
    labBookings,
    labCompleted,
    papSubmitted,
    papCompleted,
    repeatOrderGroups,
    doctorReReferralGroups,
    journeyReturns,
    knowledgeViews,
    trialInterests,
    publishedStories,
    papApprovalTimes,
    prescriptionQueries,
    pharmacyCompleted,
    prescriptionReviewCount
  ] = await prisma.$transaction([
    prisma.referral.count({ where: createdRange }),
    prisma.referral.count({ where: { ...createdRange, status: { in: [ReferralStatus.ORDERED, ReferralStatus.FULFILLED] } } }),
    prisma.appointment.groupBy({ by: ["consultationType"], where: createdRange, orderBy: { consultationType: "asc" }, _count: { _all: true } }),
    prisma.labBooking.count({ where: createdRange }),
    prisma.labBooking.count({ where: { ...createdRange, status: LabBookingStatus.COMPLETED } }),
    prisma.pAPApplication.count({ where: createdRange }),
    prisma.pAPApplication.count({ where: { ...createdRange, status: PapApplicationStatus.COMPLETED } }),
    prisma.order.groupBy({ by: ["patientId"], where: { ...createdRange, status: OrderStatus.DELIVERED }, orderBy: { patientId: "asc" }, _count: { _all: true }, having: { patientId: { _count: { gt: 1 } } } }),
    prisma.referral.groupBy({ by: ["doctorId", "patientId"], where: createdRange, orderBy: [{ doctorId: "asc" }, { patientId: "asc" }], _count: { _all: true }, having: { patientId: { _count: { gt: 1 } } } }),
    prisma.analyticsEvent.count({ where: { ...createdRange, eventName: AnalyticsEventName.JOURNEY_STAGE_RETURNED } }),
    prisma.analyticsEvent.count({ where: { ...createdRange, eventName: AnalyticsEventName.KNOWLEDGE_ARTICLE_VIEWED } }),
    prisma.trialInterest.count({ where: createdRange }),
    prisma.patientStory.count({ where: { ...createdRange, isPublished: true, status: PatientStoryStatus.APPROVED } }),
    prisma.pAPApplication.findMany({ where: { ...createdRange, status: { in: [PapApplicationStatus.APPROVED, PapApplicationStatus.COMPLETED] }, reviewedAt: { not: null } }, select: { createdAt: true, reviewedAt: true } }),
    prisma.prescription.count({ where: { ...createdRange, status: PrescriptionStatus.QUERY } }),
    prisma.order.count({ where: { ...createdRange, status: OrderStatus.DELIVERED } }),
    prisma.prescription.count({ where: { ...createdRange, status: { in: [PrescriptionStatus.VERIFIED, PrescriptionStatus.REJECTED, PrescriptionStatus.QUERY] } } })
  ]);

  const consultationModeSplit = { IN_CLINIC: 0, PHONE: 0 };
  for (const mode of consultationModes) {
    consultationModeSplit[mode.consultationType] = typeof mode._count === "object" ? mode._count._all ?? 0 : 0;
  }
  const averagePapApprovalTimeHours = papApprovalTimes.length === 0 ? null : papApprovalTimes.reduce((total, item) => total + ((item.reviewedAt!.getTime() - item.createdAt.getTime()) / 3_600_000), 0) / papApprovalTimes.length;

  return {
    referralConversion: { converted: referralsConverted, created: referralsCreated, rate: rate(referralsConverted, referralsCreated) },
    consultationModeSplit,
    labConversion: { completed: labCompleted, bookings: labBookings, rate: rate(labCompleted, labBookings) },
    papCompletion: { completed: papCompleted, submitted: papSubmitted, rate: rate(papCompleted, papSubmitted) },
    repeatPharmacyOrders: { patients: repeatOrderGroups.length },
    doctorReReferral: { doctorPatientPairs: doctorReReferralGroups.length },
    journeyReturns: { count: journeyReturns },
    knowledgeEngagement: { articleViews: knowledgeViews },
    clinicalTrialInterests: { submitted: trialInterests },
    patientStories: { published: publishedStories },
    papApprovalTime: { averageHours: averagePapApprovalTimeHours === null ? null : Number(averagePapApprovalTimeHours.toFixed(2)), approvedApplications: papApprovalTimes.length },
    prescriptionQueryRate: { queried: prescriptionQueries, reviewed: prescriptionReviewCount, rate: rate(prescriptionQueries, prescriptionReviewCount) },
    completedPharmacyOrders: pharmacyCompleted
  };
}

export async function listAnalyticsEvents(query: AnalyticsEventsQuery) {
  const where = {
    ...(query.eventName ? { eventName: query.eventName as AnalyticsEventName } : {}),
    ...rangeWhere(query)
  };
  const skip = (query.page - 1) * query.pageSize;
  const [total, events] = await prisma.$transaction([
    prisma.analyticsEvent.count({ where }),
    prisma.analyticsEvent.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: query.pageSize, select: { id: true, eventName: true, userId: true, entityType: true, entityId: true, createdAt: true } })
  ]);
  return { items: events.map((event) => ({ eventId: event.id, eventName: event.eventName, userId: event.userId, entityType: event.entityType, entityId: event.entityId, createdAt: event.createdAt.toISOString() })), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
}

function rate(numerator: number, denominator: number) { return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4)); }