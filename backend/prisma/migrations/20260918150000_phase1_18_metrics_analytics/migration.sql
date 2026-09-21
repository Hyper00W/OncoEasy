-- CreateEnum
CREATE TYPE "AnalyticsEventName" AS ENUM ('REFERRAL_CREATED', 'REFERRAL_ORDERED', 'REFERRAL_FULFILLED', 'CONSULTATION_BOOKED', 'CONSULTATION_COMPLETED', 'LAB_BOOKING_CREATED', 'PAP_SUBMITTED', 'PAP_COMPLETED', 'PHARMACY_ORDER_COMPLETED', 'DOCTOR_REFERRAL_CREATED', 'JOURNEY_STAGE_RETURNED', 'KNOWLEDGE_ARTICLE_VIEWED', 'TRIAL_INTEREST_SUBMITTED', 'PATIENT_STORY_PUBLISHED', 'PAP_STATUS_CHANGED', 'PRESCRIPTION_QUERY_CREATED');

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL,
    "event_name" "AnalyticsEventName" NOT NULL,
    "user_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "analytics_events_event_name_created_at_idx" ON "analytics_events"("event_name", "created_at");
CREATE INDEX "analytics_events_created_at_idx" ON "analytics_events"("created_at");
CREATE INDEX "analytics_events_user_id_created_at_idx" ON "analytics_events"("user_id", "created_at");
CREATE INDEX "analytics_events_entity_type_entity_id_idx" ON "analytics_events"("entity_type", "entity_id");
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;