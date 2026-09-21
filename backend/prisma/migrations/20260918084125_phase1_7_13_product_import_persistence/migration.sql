-- CreateEnum
CREATE TYPE "ProductImportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED');

-- CreateEnum
CREATE TYPE "ProductImportRowStatus" AS ENUM ('VALID', 'INVALID', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProductImportRowAction" AS ENUM ('CREATE', 'UPDATE', 'SKIPPED');

-- CreateTable
CREATE TABLE "product_import_jobs" (
    "id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "status" "ProductImportJobStatus" NOT NULL DEFAULT 'PENDING',
    "file_name" TEXT,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "created_products" INTEGER NOT NULL DEFAULT 0,
    "updated_products" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_import_rows" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "sku" TEXT,
    "status" "ProductImportRowStatus" NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "action" "ProductImportRowAction",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_import_jobs_created_by_user_id_idx" ON "product_import_jobs"("created_by_user_id");

-- CreateIndex
CREATE INDEX "product_import_jobs_status_idx" ON "product_import_jobs"("status");

-- CreateIndex
CREATE INDEX "product_import_rows_job_id_idx" ON "product_import_rows"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_import_rows_job_id_row_number_key" ON "product_import_rows"("job_id", "row_number");

-- AddForeignKey
ALTER TABLE "product_import_jobs" ADD CONSTRAINT "product_import_jobs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_import_rows" ADD CONSTRAINT "product_import_rows_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "product_import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
