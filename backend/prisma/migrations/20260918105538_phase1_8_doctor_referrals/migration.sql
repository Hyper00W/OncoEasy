/*
  Warnings:

  - A unique constraint covering the columns `[referral_id]` on the table `orders` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('SENT', 'VIEWED', 'ORDERED', 'FULFILLED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "referral_id" UUID;

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "access_token_hash" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'SENT',
    "viewed_at" TIMESTAMP(3),
    "ordered_at" TIMESTAMP(3),
    "fulfilled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_items" (
    "id" UUID NOT NULL,
    "referral_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "product_name_snapshot" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referrals_access_token_hash_key" ON "referrals"("access_token_hash");

-- CreateIndex
CREATE INDEX "referrals_doctor_id_created_at_idx" ON "referrals"("doctor_id", "created_at");

-- CreateIndex
CREATE INDEX "referrals_patient_id_created_at_idx" ON "referrals"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "referrals_status_idx" ON "referrals"("status");

-- CreateIndex
CREATE INDEX "referral_items_product_id_idx" ON "referral_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "referral_items_referral_id_product_id_key" ON "referral_items"("referral_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_referral_id_key" ON "orders"("referral_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referrals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_items" ADD CONSTRAINT "referral_items_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_items" ADD CONSTRAINT "referral_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
