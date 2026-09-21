-- CreateEnum
CREATE TYPE "PatientStoryStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "patient_stories" (
    "id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "story" TEXT NOT NULL,
    "photo_storage_key" TEXT,
    "photo_document_name" TEXT,
    "photo_mime_type" TEXT,
    "photo_checksum" TEXT,
    "photo_uploaded_at" TIMESTAMP(3),
    "consent_given" BOOLEAN NOT NULL,
    "consent_text_version" TEXT,
    "status" "PatientStoryStatus" NOT NULL DEFAULT 'DRAFT',
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_stories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_stories_is_published_idx" ON "patient_stories"("is_published");

-- CreateIndex
CREATE INDEX "patient_stories_status_idx" ON "patient_stories"("status");

-- AddForeignKey
ALTER TABLE "patient_stories" ADD CONSTRAINT "patient_stories_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_stories" ADD CONSTRAINT "patient_stories_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
