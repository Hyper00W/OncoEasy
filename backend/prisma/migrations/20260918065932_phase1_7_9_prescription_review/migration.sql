-- AlterEnum
ALTER TYPE "PrescriptionStatus" ADD VALUE 'QUERY';

-- AlterTable
ALTER TABLE "prescriptions" ADD COLUMN     "review_reason" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMP(3);
