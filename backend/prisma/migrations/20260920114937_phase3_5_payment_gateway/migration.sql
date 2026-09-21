-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "provider_order_id" TEXT;

-- CreateIndex
CREATE INDEX "payments_provider_order_id_idx" ON "payments"("provider_order_id");
