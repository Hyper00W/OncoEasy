import { UserRole } from "@prisma/client";

import { prisma } from "../../database/prisma";
import { AppError } from "../../errors/app-error";

export type PatientDashboard = {
  nextStep: {
    type: "COMPLETE_PROFILE";
    label: string;
  } | null;
  upcomingAppointment: null;
  activeOrders: never[];
  referral: null;
  labTests: never[];
  papStatus: null;
  quickLinks: Array<{
    key: string;
    label: string;
    path: string;
    available: false;
  }>;
};

const quickLinks: PatientDashboard["quickLinks"] = [
  {
    key: "pharmacy",
    label: "Pharmacy",
    path: "/patient/pharmacy",
    available: false
  },
  {
    key: "doctor-consult",
    label: "Doctor Consult",
    path: "/patient/doctor-consult",
    available: false
  },
  {
    key: "lab-tests",
    label: "Lab Tests",
    path: "/patient/lab-tests",
    available: false
  },
  {
    key: "pap",
    label: "PAP",
    path: "/patient/pap",
    available: false
  },
  {
    key: "care-journey",
    label: "Care Journey",
    path: "/patient/care-journey",
    available: false
  },
  {
    key: "knowledge-bank",
    label: "Knowledge Bank",
    path: "/patient/knowledge-bank",
    available: false
  }
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

  return {
    nextStep: onboardingComplete
      ? null
      : {
          type: "COMPLETE_PROFILE",
          label: "Complete your profile"
        },
    upcomingAppointment: null,
    activeOrders: [],
    referral: null,
    labTests: [],
    papStatus: null,
    quickLinks
  };
}
