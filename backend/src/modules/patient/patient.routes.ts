import { UserRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../database/prisma";
import { AppError } from "../../errors/app-error";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/require-role";
import { getPatientDashboard } from "./patient-dashboard.service";

const diagnosisStageValues = [
  "EARLY_STAGE",
  "LOCALLY_ADVANCED",
  "ADVANCED",
  "NOT_SURE"
] as const;

const onboardingSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    diagnosisStage: z.enum(diagnosisStageValues),
    city: z.string().trim().min(2).max(100)
  })
  .strict();

export const patientRouter = Router();

patientRouter.use(authenticate, requireRole(UserRole.PATIENT));

patientRouter.get("/dashboard", async (request, response, next) => {
  try {
    const dashboard = await getPatientDashboard(request.user?.userId);

    response.status(200).json({
      success: true,
      data: dashboard,
      message: "Patient dashboard retrieved"
    });
  } catch (error) {
    next(error);
  }
});

patientRouter.get("/me", async (request, response, next) => {
  try {
    const user = await findAuthenticatedPatient(request.user?.userId);

    response.status(200).json({
      success: true,
      data: {
        user: toPatientIdentity(user),
        onboardingCompleted: isOnboardingComplete(user)
      },
      message: "Patient profile retrieved"
    });
  } catch (error) {
    next(error);
  }
});

patientRouter.patch("/onboarding", async (request, response, next) => {
  try {
    const parsed = onboardingSchema.safeParse(request.body);

    if (!parsed.success) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "Full name, diagnosis stage, and city are required"
      );
    }

    const user = await findAuthenticatedPatient(request.user?.userId);
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: parsed.data
    });

    response.status(200).json({
      success: true,
      data: {
        user: toPatientIdentity(updatedUser),
        onboardingCompleted: isOnboardingComplete(updatedUser)
      },
      message: "Patient profile completed"
    });
  } catch (error) {
    next(error);
  }
});

function isOnboardingComplete(user: {
  fullName: string;
  diagnosisStage: string | null;
  city: string | null;
}): boolean {
  return (
    user.fullName.trim().length > 0 &&
    user.fullName !== "Pending onboarding" &&
    user.diagnosisStage !== null &&
    user.city !== null
  );
}

async function findAuthenticatedPatient(userId: string | undefined) {
  if (!userId) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication is required");
  }

  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      role: UserRole.PATIENT,
      isActive: true
    }
  });

  if (!user) {
    throw new AppError(404, "PATIENT_NOT_FOUND", "Patient profile was not found");
  }

  return user;
}

function toPatientIdentity(user: {
  id: string;
  fullName: string;
  phone: string | null;
  role: UserRole;
}) {
  return {
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role
  };
}
