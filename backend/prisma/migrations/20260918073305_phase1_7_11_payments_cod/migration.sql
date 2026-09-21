-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PREPAID', 'COD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED', 'CASH_COLLECTED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivery_pincode" VARCHAR(10);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_pincodes" (
    "id" UUID NOT NULL,
    "pincode" VARCHAR(10) NOT NULL,
    "local_delivery_eligible" BOOLEAN NOT NULL DEFAULT false,
    "courier_delivery_eligible" BOOLEAN NOT NULL DEFAULT false,
    "cold_chain_eligible" BOOLEAN NOT NULL DEFAULT false,
    "cod_eligible" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_pincodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_pincodes_pincode_key" ON "delivery_pincodes"("pincode");

-- CreateIndex
CREATE INDEX "orders_delivery_pincode_idx" ON "orders"("delivery_pincode");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_pincode_fkey" FOREIGN KEY ("delivery_pincode") REFERENCES "delivery_pincodes"("pincode") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
