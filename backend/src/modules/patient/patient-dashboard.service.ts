import { UserRole } from "@prisma/client";

import { prisma } from "../../database/prisma";
import { AppError } from "../../errors/app-error";

export type PatientDashboard = {
  nextStep: {
    type: "COMPLETE_PROFILE";
    label: string;
  } | null;
  upcomingAppointment: {
    appointmentId: string;
    scheduledAt: string;
    consultationType: "IN_CLINIC" | "PHONE";
    status: string;
    doctorName: string | null;
  } | null;
  activeOrders: Array<{
    orderId: string;
    status: string;
    totalAmount: string;
    currency: string;
    itemCount: number;
  }>;
  referral: {
    referralId: string;
    status: string;
    createdAt: string;
  } | null;
  labTests: Array<{
    bookingId: string;
    testId: string;
    name: string;
    status: string;
    preferredDate: string;
  }>;
  papStatus: {
    applicationId: string;
    status: string;
    programName: string;
    updatedAt: string;
  } | null;
  quickLinks: Array<{
    key: "pharmacy" | "doctor-consult" | "lab-tests" | "pap" | "care-journey" | "knowledge-bank" | "patient-stories" | "testimonials" | "chat";
    label: string;
    path: string;
    available: boolean;
  }>;
};

const quickLinks: PatientDashboard["quickLinks"] = [
  { key: "pharmacy", label: "Pharmacy", path: "/patient/pharmacy", available: true },
  { key: "doctor-consult", label: "Doctor Consult", path: "/patient/consultations", available: true },
  { key: "lab-tests", label: "Lab Tests", path: "/patient/labs", available: true },
  { key: "pap", label: "PAP", path: "/patient/pap", available: true },
  { key: "care-journey", label: "Care Journey", path: "/patient/journey", available: true },
  { key: "knowledge-bank", label: "Knowledge Bank", path: "/patient/knowledge", available: true },
  { key: "patient-stories", label: "Patient Stories", path: "/patient/stories", available: true },
  { key: "testimonials", label: "Testimonials", path: "/patient/testimonials", available: true },
  { key: "chat", label: "Chat Router", path: "/patient/chat", available: true }
];

export async function getPatientDashboard(
  userId: string | undefined
): Promise<PatientDashboard> {
  if (!userId) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication is required");
  }

  const patient = await prisma.user.findFirst({
    where: {
      id: userId,
      role: UserRole.PATIENT,
      isActive: true
    },
    select: {
      id: true,
      fullName: true,
      diagnosisStage: true,
      city: true
    }
  });

  if (!patient) {
    throw new AppError(404, "PATIENT_NOT_FOUND", "Patient profile was not found");
  }

  const onboardingComplete =
    patient.fullName.trim().length > 0 &&
    patient.fullName !== "Pending onboarding" &&
    patient.diagnosisStage !== null &&
    patient.city !== null;

  const now = new Date();

  const [
    upcomingAppointment,
    activeOrders,
    referral,
    labBookings,
    papApplication
  ] = await Promise.all([
    prisma.appointment.findFirst({
      where: {
        patientId: patient.id,
        scheduledAt: { gte: now },
        status: { in: ["PENDING", "CONFIRMED"] }
      },
      orderBy: { scheduledAt: "asc" },
      select: {
        id: true,
        scheduledAt: true,
        consultationType: true,
        status: true,
        doctor: { select: { fullName: true } }
      }
    }),
    prisma.order.findMany({
      where: {
        patientId: patient.id,
        status: {
          in: [
            "PENDING_PRESCRIPTION",
            "PENDING_PHARMACIST_REVIEW",
            "PENDING_PAYMENT",
            "PAID",
            "PROCESSING",
            "READY_FOR_DELIVERY",
            "OUT_FOR_DELIVERY",
            "SHIPPED"
          ]
        }
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        status: true,
        totalAmount: true,
        currency: true,
        _count: { select: { items: true } }
      }
    }),
    prisma.referral.findFirst({
      where: { patientId: patient.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, createdAt: true }
    }),
    prisma.labBooking.findMany({
      where: { patientId: patient.id },
      orderBy: { preferredDate: "desc" },
      take: 5,
      select: {
        id: true,
        labTestId: true,
        status: true,
        preferredDate: true,
        labTest: { select: { name: true } }
      }
    }),
    prisma.pAPApplication.findFirst({
      where: { patientId: patient.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        papProgram: { select: { name: true } }
      }
    })
  ]);

  return {
    nextStep: onboardingComplete
      ? null
      : {
          type: "COMPLETE_PROFILE",
          label: "Complete your profile"
        },
    upcomingAppointment: upcomingAppointment
      ? {
          appointmentId: upcomingAppointment.id,
          scheduledAt: upcomingAppointment.scheduledAt.toISOString(),
          consultationType: upcomingAppointment.consultationType,
          status: upcomingAppointment.status,
          doctorName: upcomingAppointment.doctor.fullName
        }
      : null,
    activeOrders: activeOrders.map((order) => ({
      orderId: order.id,
      status: order.status,
      totalAmount: order.totalAmount.toString(),
      currency: order.currency,
      itemCount: order._count.items
    })),
    referral: referral
      ? {
          referralId: referral.id,
          status: referral.status,
          createdAt: referral.createdAt.toISOString()
        }
      : null,
    labTests: labBookings.map((booking) => ({
      bookingId: booking.id,
      testId: booking.labTestId,
      name: booking.labTest.name,
      status: booking.status,
      preferredDate: booking.preferredDate.toISOString()
    })),
    papStatus: papApplication
      ? {
          applicationId: papApplication.id,
          status: papApplication.status,
          programName: papApplication.papProgram.name,
          updatedAt: papApplication.updatedAt.toISOString()
        }
      : null,
    quickLinks
  };
}
