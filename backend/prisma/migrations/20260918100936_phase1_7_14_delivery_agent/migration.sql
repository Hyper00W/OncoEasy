-- CreateEnum
CREATE TYPE "DeliveryProofType" AS ENUM ('DELIVERY_PHOTO', 'CASH_OVER_BILL', 'ONLINE_PAYMENT');

-- AlterEnum
ALTER TYPE "DeliveryStatus" ADD VALUE 'ASSIGNED';

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'DELIVERY_AGENT';

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "agent_id" UUID,
ADD COLUMN     "assigned_at" TIMESTAMP(3),
ADD COLUMN     "failed_at" TIMESTAMP(3),
ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "out_for_delivery_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "delivery_proofs" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "type" "DeliveryProofType" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "document_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_proofs_delivery_id_idx" ON "delivery_proofs"("delivery_id");

-- CreateIndex
CREATE INDEX "deliveries_agent_id_idx" ON "deliveries"("agent_id");

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
