-- CreateEnum
CREATE TYPE "PapApplicationStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED', 'APPROVED', 'REJECTED', 'COMPLETED');

-- CreateTable
CREATE TABLE "pap_programs" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "eligibility_description" TEXT NOT NULL,
    "required_documents" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pap_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pap_applications" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "pap_program_id" UUID NOT NULL,
    "status" "PapApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "application_data" JSONB NOT NULL,
    "review_notes" TEXT,
    "review_reason" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pap_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pap_application_documents" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "document_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pap_application_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pap_programs_is_active_idx" ON "pap_programs"("is_active");

-- CreateIndex
CREATE INDEX "pap_applications_patient_id_created_at_idx" ON "pap_applications"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "pap_applications_pap_program_id_idx" ON "pap_applications"("pap_program_id");

-- CreateIndex
CREATE INDEX "pap_applications_status_created_at_idx" ON "pap_applications"("status", "created_at");

-- CreateIndex
CREATE INDEX "pap_application_documents_application_id_uploaded_at_idx" ON "pap_application_documents"("application_id", "uploaded_at");

-- AddForeignKey
ALTER TABLE "pap_applications" ADD CONSTRAINT "pap_applications_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pap_applications" ADD CONSTRAINT "pap_applications_pap_program_id_fkey" FOREIGN KEY ("pap_program_id") REFERENCES "pap_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pap_applications" ADD CONSTRAINT "pap_applications_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pap_application_documents" ADD CONSTRAINT "pap_application_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "pap_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
