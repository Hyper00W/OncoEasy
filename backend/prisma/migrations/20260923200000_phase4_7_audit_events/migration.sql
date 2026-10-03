-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'OTP_REQUESTED', 'OTP_VERIFICATION_FAILED', 'LOGOUT', 'REFRESH_TOKEN_ROTATED', 'REFRESH_TOKEN_REJECTED', 'SESSIONS_REVOKED', 'PRESCRIPTION_SUBMITTED', 'PRESCRIPTION_VERIFIED', 'PRESCRIPTION_REJECTED', 'PRESCRIPTION_QUERIED', 'ORDER_CREATED', 'PAYMENT_INITIATED', 'PAYMENT_VERIFIED', 'DELIVERY_ASSIGNED', 'DELIVERY_COMPLETED', 'DELIVERY_FAILED', 'REFERRAL_CREATED', 'REFERRAL_STATUS_CHANGED', 'APPOINTMENT_CREATED', 'APPOINTMENT_STATUS_CHANGED', 'LAB_BOOKING_CREATED', 'LAB_BOOKING_STATUS_CHANGED', 'LAB_REPORT_UPLOADED', 'PAP_APPLICATION_CREATED', 'PAP_STATUS_CHANGED', 'TESTIMONIAL_CREATED', 'TESTIMONIAL_UPDATED', 'TESTIMONIAL_PUBLISHED', 'TESTIMONIAL_UNPUBLISHED', 'TESTIMONIAL_MEDIA_REPLACED', 'TESTIMONIAL_DELETED', 'TRIAL_CREATED', 'TRIAL_UPDATED', 'TRIAL_PUBLISHED', 'TRIAL_INTEREST_STATUS_CHANGED', 'STORY_CREATED', 'STORY_UPDATED', 'STORY_STATUS_CHANGED', 'STORY_PUBLISHED', 'STORY_PHOTO_REPLACED', 'KNOWLEDGE_ARTICLE_CREATED', 'KNOWLEDGE_ARTICLE_UPDATED', 'KNOWLEDGE_ARTICLE_PUBLISHED', 'PRODUCT_IMPORT_COMPLETED');

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "event_type" "AuditEventType" NOT NULL,
    "actor_user_id" UUID,
    "actor_role" TEXT,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID,
    "request_id" VARCHAR(64),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_created_at_idx" ON "audit_events"("created_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_user_id_created_at_idx" ON "audit_events"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_resource_type_resource_id_idx" ON "audit_events"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_events_event_type_created_at_idx" ON "audit_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_request_id_idx" ON "audit_events"("request_id");

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
