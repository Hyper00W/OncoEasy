-- CreateEnum
CREATE TYPE "LabCollectionType" AS ENUM ('HOME', 'CENTER');

-- CreateEnum
CREATE TYPE "LabBookingStatus" AS ENUM ('PENDING_OPS', 'BOOKED', 'SAMPLE_COLLECTED', 'REPORT_READY', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "lab_tests" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "preparation_instructions" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "requires_prescription" BOOLEAN NOT NULL DEFAULT false,
    "home_collection_available" BOOLEAN NOT NULL DEFAULT true,
    "center_collection_available" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_bookings" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "lab_test_id" UUID NOT NULL,
    "collection_type" "LabCollectionType" NOT NULL,
    "preferred_date" DATE NOT NULL,
    "preferred_time_slot" TEXT,
    "patient_notes" TEXT,
    "address_data" JSONB,
    "prescription_id" UUID,
    "status" "LabBookingStatus" NOT NULL DEFAULT 'PENDING_OPS',
    "external_order_id" TEXT,
    "report_storage_key" TEXT,
    "report_document_name" TEXT,
    "report_mime_type" TEXT,
    "report_checksum" TEXT,
    "report_uploaded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lab_tests_category_idx" ON "lab_tests"("category");

-- CreateIndex
CREATE INDEX "lab_tests_is_active_idx" ON "lab_tests"("is_active");

-- CreateIndex
CREATE INDEX "lab_bookings_patient_id_preferred_date_idx" ON "lab_bookings"("patient_id", "preferred_date");

-- CreateIndex
CREATE INDEX "lab_bookings_status_preferred_date_idx" ON "lab_bookings"("status", "preferred_date");

-- CreateIndex
CREATE INDEX "lab_bookings_lab_test_id_idx" ON "lab_bookings"("lab_test_id");

-- AddForeignKey
ALTER TABLE "lab_bookings" ADD CONSTRAINT "lab_bookings_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_bookings" ADD CONSTRAINT "lab_bookings_lab_test_id_fkey" FOREIGN KEY ("lab_test_id") REFERENCES "lab_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_bookings" ADD CONSTRAINT "lab_bookings_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
