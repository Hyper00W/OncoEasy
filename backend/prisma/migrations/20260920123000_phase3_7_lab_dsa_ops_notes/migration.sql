/*
  Phase 3.7 — Thyrocare DSA operational workflow.

  1. Unique constraint on `lab_bookings.external_order_id`:
     an external (Thyrocare DSA) order reference must map to at most one
     booking so Ops can never accidentally attach the same DSA reference to
     two bookings. Nullable column, so bookings without a reference (all
     pre-existing rows) are unaffected.
  2. `lab_bookings.ops_notes` (nullable JSON): Ops-only operational notes for
     the manual DSA workflow. Never exposed to patients.
*/

-- DropIndex (defensive; constraint may not exist in fresh databases)
DROP INDEX IF EXISTS "lab_bookings_external_order_id_key";

-- AlterTable
ALTER TABLE "lab_bookings" ADD COLUMN IF NOT EXISTS "ops_notes" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "lab_bookings_external_order_id_key" ON "lab_bookings"("external_order_id");

-- CreateIndex (secondary lookup index, mirrors @@index([externalOrderId]))
CREATE INDEX IF NOT EXISTS "lab_bookings_external_order_id_idx" ON "lab_bookings"("external_order_id");
