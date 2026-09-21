-- CreateEnum
CREATE TYPE "ChatSessionStatus" AS ENUM ('ACTIVE', 'ESCALATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChatIntent" AS ENUM ('PHARMACY', 'DOCTOR_CONSULT', 'LABS', 'PAP', 'CARE_JOURNEY', 'KNOWLEDGE', 'CLINICAL_TRIALS', 'HUMAN_SUPPORT', 'GENERAL');

-- CreateEnum
CREATE TYPE "ChatMessageSender" AS ENUM ('PATIENT', 'ROUTER', 'SYSTEM');

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "status" "ChatSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "intent" "ChatIntent" NOT NULL DEFAULT 'GENERAL',
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "sender" "ChatMessageSender" NOT NULL,
    "content" TEXT NOT NULL,
    "intent" "ChatIntent",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chat_sessions_patient_id_updated_at_idx" ON "chat_sessions"("patient_id", "updated_at");
CREATE INDEX "chat_sessions_escalated_status_updated_at_idx" ON "chat_sessions"("escalated", "status", "updated_at");
CREATE INDEX "chat_messages_session_id_created_at_idx" ON "chat_messages"("session_id", "created_at");
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;