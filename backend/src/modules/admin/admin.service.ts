import { AppointmentStatus, ChatSessionStatus, DeliveryStatus, LabBookingStatus, OrderStatus, PapApplicationStatus, PrescriptionStatus, ReferralStatus, PatientStoryStatus } from "@prisma/client";

import { prisma } from "../../database/prisma";

export async function getAdminOverview() {
  const now = new Date();
  const [
    pendingPrescriptionReviews,
    pendingOrders,
    activeDeliveries,
    pendingReferrals,
    upcomingConsultations,
    pendingLabBookings,
    papApplicationsRequiringAttention,
    draftKnowledgeArticles,
    unpublishedClinicalTrials,
    storiesAwaitingReview,
    escalatedChatSessions
  ] = await prisma.$transaction([
    prisma.prescription.count({ where: { status: PrescriptionStatus.PENDING_REVIEW } }),
    prisma.order.count({ where: { status: { in: [OrderStatus.PENDING_PRESCRIPTION, OrderStatus.PENDING_PHARMACIST_REVIEW, OrderStatus.PENDING_PAYMENT] } } }),
    prisma.delivery.count({ where: { status: { in: [DeliveryStatus.PENDING, DeliveryStatus.ASSIGNED, DeliveryStatus.READY_FOR_DELIVERY, DeliveryStatus.OUT_FOR_DELIVERY, DeliveryStatus.SHIPPED] } } }),
    prisma.referral.count({ where: { status: { in: [ReferralStatus.SENT, ReferralStatus.VIEWED] } } }),
    prisma.appointment.count({ where: { status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] }, scheduledAt: { gte: now } } }),
    prisma.labBooking.count({ where: { status: LabBookingStatus.PENDING_OPS } }),
    prisma.pAPApplication.count({ where: { status: { in: [PapApplicationStatus.SUBMITTED, PapApplicationStatus.UNDER_REVIEW, PapApplicationStatus.MORE_INFORMATION_REQUIRED] } } }),
    prisma.knowledgeArticle.count({ where: { isPublished: false } }),
    prisma.clinicalTrial.count({ where: { isPublished: false } }),
    prisma.patientStory.count({ where: { status: PatientStoryStatus.UNDER_REVIEW } }),
    prisma.chatSession.count({ where: { escalated: true, status: ChatSessionStatus.ESCALATED } })
  ]);

  return {
    pendingPrescriptionReviews,
    pendingOrders,
    activeDeliveries,
    pendingReferrals,
    upcomingConsultations,
    pendingLabBookings,
    papApplicationsRequiringAttention,
    draftKnowledgeArticles,
    unpublishedClinicalTrials,
    storiesAwaitingReview,
    escalatedChatSessions
  };
}