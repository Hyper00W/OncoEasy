import { JourneyStageKey, PatientStoryStatus, Prisma, PrismaClient, UserRole } from "@prisma/client";

import { env } from "../src/config/env";
import { hashPassword } from "../src/services/password";

if (env.NODE_ENV !== "development") {
  throw new Error("The development seed can only run when NODE_ENV=development");
}

const prisma = new PrismaClient();
const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "ops-admin@oncoeasy.local";
const adminPassword =
  process.env.SEED_ADMIN_PASSWORD ?? "dev-only-change-me";

async function main(): Promise<void> {
  const passwordHash = await hashPassword(adminPassword);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      fullName: "OncoEasy Operations Admin",
      passwordHash,
      role: UserRole.OPS_ADMIN,
      isActive: true,
      isVerified: true
    },
    create: {
      fullName: "OncoEasy Operations Admin",
      email: adminEmail,
      passwordHash,
      role: UserRole.OPS_ADMIN,
      isActive: true,
      isVerified: true
    }
  });

  const labTests = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "CBC",
      description: "Complete blood count for anemia, infection, and blood cell trends.",
      category: "Blood Tests",
      preparationInstructions: "No fasting required. Follow your usual hydration routine.",
      price: new Prisma.Decimal("799.00"),
      currency: "INR",
      requiresPrescription: false,
      homeCollectionAvailable: true,
      centerCollectionAvailable: true,
      isActive: true
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Liver Function Test",
      description: "Liver enzyme and function profile for monitoring hepatic health.",
      category: "Liver Profile",
      preparationInstructions: "Fasting for 8 to 12 hours is recommended before the sample.",
      price: new Prisma.Decimal("1299.00"),
      currency: "INR",
      requiresPrescription: false,
      homeCollectionAvailable: true,
      centerCollectionAvailable: true,
      isActive: true
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Kidney/Renal Function Test",
      description: "Creatinine, urea, and electrolyte panel for renal assessment.",
      category: "Kidney Profile",
      preparationInstructions: "Hydrate normally unless your clinician advises otherwise.",
      price: new Prisma.Decimal("1499.00"),
      currency: "INR",
      requiresPrescription: false,
      homeCollectionAvailable: true,
      centerCollectionAvailable: true,
      isActive: true
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Thyroid Function Test",
      description: "TSH and thyroid hormone profile for endocrine monitoring.",
      category: "Endocrine",
      preparationInstructions: "No fasting required. Inform the team if you are taking thyroid medication.",
      price: new Prisma.Decimal("1699.00"),
      currency: "INR",
      requiresPrescription: false,
      homeCollectionAvailable: true,
      centerCollectionAvailable: true,
      isActive: true
    }
  ] as const;

  for (const test of labTests) {
    await prisma.labTest.upsert({
      where: { id: test.id },
      update: {
        ...test,
        price: test.price
      },
      create: {
        ...test,
        price: test.price
      }
    });
  }

  const papPrograms = [
    {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Generic Treatment Support Demo",
      description: "Demo patient assistance support for eligible treatment costs.",
      eligibilityDescription: "Demo eligibility information. Applications are reviewed manually by OncoEasy operations.",
      requiredDocuments: ["Government identity document", "Income or financial support document"],
      isActive: true
    },
    {
      id: "66666666-6666-4666-8666-666666666666",
      name: "Generic Care Access Demo",
      description: "Demo support program for care access and treatment coordination.",
      eligibilityDescription: "Demo eligibility information. No automated eligibility decision is made.",
      requiredDocuments: ["Government identity document", "Treatment summary"],
      isActive: true
    }
  ] as const;

  for (const program of papPrograms) {
    await prisma.pAPProgram.upsert({
      where: { id: program.id },
      update: program,
      create: program
    });
  }

  const journeyStages = [
    {
      key: JourneyStageKey.DIAGNOSED,
      order: 1,
      title: "Diagnosed",
      description: "A diagnosis has been confirmed and you are gathering information about the care journey.",
      checklist: ["Review your care information", "Write down questions for your care team", "Keep important reports together"],
      isActive: true
    },
    {
      key: JourneyStageKey.TREATMENT_PLANNING,
      order: 2,
      title: "Treatment Planning",
      description: "Your care team is discussing options and preparing a plan with you.",
      checklist: ["Review the proposed plan with your care team", "Note upcoming appointments", "Ask which documents to bring"],
      isActive: true
    },
    {
      key: JourneyStageKey.ACTIVE_TREATMENT,
      order: 3,
      title: "Active Treatment",
      description: "You are following a treatment plan and keeping in touch with your care team.",
      checklist: ["Keep your appointment schedule available", "Record questions or changes to discuss", "Follow the instructions provided by your care team"],
      isActive: true
    },
    {
      key: JourneyStageKey.FOLLOW_UP,
      order: 4,
      title: "Follow-up",
      description: "You are attending follow-up care and reviewing the next steps with your care team.",
      checklist: ["Keep follow-up appointments", "Bring requested reports", "Discuss ongoing support needs"],
      isActive: true
    }
  ] as const;

  for (const stage of journeyStages) {
    await prisma.journeyStage.upsert({
      where: { key: stage.key },
      update: stage,
      create: stage
    });
  }

  const knowledgeArticles = [
    {
      id: "77777777-7777-4777-8777-777777777777",
      title: "Understanding a cancer diagnosis",
      slug: "understanding-a-cancer-diagnosis",
      category: "DISEASE" as const,
      summary: "A general overview of questions and information to gather after a diagnosis.",
      content: "A diagnosis can bring many questions. Keep your reports together, write down questions, and discuss information with your qualified care team.",
      isPublished: true
    },
    {
      id: "88888888-8888-4888-8888-888888888888",
      title: "Preparing for treatment discussions",
      slug: "preparing-for-treatment-discussions",
      category: "TREATMENT" as const,
      summary: "Practical ways to prepare for a conversation about treatment options.",
      content: "Before a treatment discussion, bring relevant reports, note medicines you take, and prepare questions about the proposed plan and follow-up.",
      isPublished: true
    },
    {
      id: "99999999-9999-4999-8999-999999999999",
      title: "How to read research information",
      slug: "how-to-read-research-information",
      category: "RESEARCH" as const,
      summary: "A concise guide to approaching general health research information.",
      content: "Research information can be complex. Check the source, publication date, and study context, and discuss questions with your care team.",
      isPublished: true
    },
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Keeping care information organized",
      slug: "keeping-care-information-organized",
      category: "GENERAL" as const,
      summary: "Simple organization ideas for appointments, reports, and questions.",
      content: "Use a folder or secure digital location for reports and appointment details. Keep a short list of questions to bring to future conversations.",
      isPublished: true
    }
  ] as const;

  for (const article of knowledgeArticles) {
    await prisma.knowledgeArticle.upsert({
      where: { id: article.id },
      update: { ...article, createdById: admin.id, updatedById: admin.id, publishedAt: article.isPublished ? new Date() : null },
      create: { ...article, createdById: admin.id, updatedById: admin.id, publishedAt: article.isPublished ? new Date() : null }
    });
  }

  const demoTrials = [
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      title: "Demo supportive care information study",
      summary: "Fictional curated demo record for a supportive care information study.",
      description: "This fictional seed record demonstrates how curated trial information may be presented. It is not a real study.",
      source: "OTHER" as const,
      sourceTrialId: "demo-supportive-care-001",
      sourceUrl: "https://example.com/demo-supportive-care-001",
      sponsor: "Fictional Demo Sponsor",
      location: "Fictional demo location",
      status: "NOT_YET_RECRUITING" as const,
      eligibilitySummary: "Fictional demo eligibility summary for development use only.",
      contactInformation: "Fictional demo contact information.",
      isPublished: true
    },
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      title: "Demo treatment planning registry",
      summary: "Fictional curated demo record for a treatment planning registry.",
      description: "This fictional seed record is for UI and API development only and does not describe a real clinical trial.",
      source: "OTHER" as const,
      sourceTrialId: "demo-treatment-planning-001",
      sourceUrl: "https://example.com/demo-treatment-planning-001",
      sponsor: "Fictional Demo Sponsor",
      location: "Fictional demo location",
      status: "RECRUITING" as const,
      eligibilitySummary: "Fictional demo eligibility summary for development use only.",
      contactInformation: "Fictional demo contact information.",
      isPublished: true
    }
  ] as const;

  for (const trial of demoTrials) {
    await prisma.clinicalTrial.upsert({
      where: { id: trial.id },
      update: { ...trial, createdById: admin.id, updatedById: admin.id, publishedAt: trial.isPublished ? new Date() : null },
      create: { ...trial, createdById: admin.id, updatedById: admin.id, publishedAt: trial.isPublished ? new Date() : null }
    });
  }

  const demoStories = [
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      displayName: "Demo patient story",
      story: "This fictional seed story demonstrates the curated Patient Stories feed. It does not describe a real patient experience or medical outcome.",
      consentGiven: true,
      consentTextVersion: "demo-v1",
      status: PatientStoryStatus.APPROVED,
      isPublished: true
    },
    {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      displayName: "Demo story draft",
      story: "This fictional draft is included for development and review workflow demonstrations only.",
      consentGiven: false,
      consentTextVersion: null,
      status: PatientStoryStatus.DRAFT,
      isPublished: false
    }
  ] as const;

  for (const story of demoStories) {
    await prisma.patientStory.upsert({
      where: { id: story.id },
      update: { ...story, createdById: admin.id, updatedById: admin.id, publishedAt: story.isPublished ? new Date() : null },
      create: { ...story, createdById: admin.id, updatedById: admin.id, publishedAt: story.isPublished ? new Date() : null }
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });