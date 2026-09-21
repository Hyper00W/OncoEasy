-- CreateEnum
CREATE TYPE "ClinicalTrialSource" AS ENUM ('CTRI', 'CLINICALTRIALS_GOV', 'OTHER');

-- CreateEnum
CREATE TYPE "ClinicalTrialStatus" AS ENUM ('NOT_YET_RECRUITING', 'RECRUITING', 'ACTIVE_NOT_RECRUITING', 'COMPLETED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TrialInterestStatus" AS ENUM ('SUBMITTED', 'CONTACTED', 'CLOSED');

-- CreateTable
CREATE TABLE "clinical_trials" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" "ClinicalTrialSource" NOT NULL,
    "source_trial_id" TEXT,
    "source_url" TEXT,
    "sponsor" TEXT,
    "location" TEXT,
    "status" "ClinicalTrialStatus" NOT NULL DEFAULT 'UNKNOWN',
    "eligibility_summary" TEXT,
    "contact_information" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_trials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_interests" (
    "id" UUID NOT NULL,
    "trial_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "notes" TEXT,
    "status" "TrialInterestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trial_interests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinical_trials_is_published_idx" ON "clinical_trials"("is_published");

-- CreateIndex
CREATE INDEX "clinical_trials_status_idx" ON "clinical_trials"("status");

-- CreateIndex
CREATE INDEX "clinical_trials_source_idx" ON "clinical_trials"("source");

-- CreateIndex
CREATE INDEX "clinical_trials_source_trial_id_idx" ON "clinical_trials"("source_trial_id");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_trials_source_source_trial_id_key" ON "clinical_trials"("source", "source_trial_id");

-- CreateIndex
CREATE INDEX "trial_interests_patient_id_created_at_idx" ON "trial_interests"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "trial_interests_status_created_at_idx" ON "trial_interests"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "trial_interests_trial_id_patient_id_key" ON "trial_interests"("trial_id", "patient_id");

-- AddForeignKey
ALTER TABLE "clinical_trials" ADD CONSTRAINT "clinical_trials_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_trials" ADD CONSTRAINT "clinical_trials_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_interests" ADD CONSTRAINT "trial_interests_trial_id_fkey" FOREIGN KEY ("trial_id") REFERENCES "clinical_trials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_interests" ADD CONSTRAINT "trial_interests_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_interests" ADD CONSTRAINT "trial_interests_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
