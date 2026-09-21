-- CreateEnum
CREATE TYPE "JourneyStageKey" AS ENUM ('DIAGNOSED', 'TREATMENT_PLANNING', 'ACTIVE_TREATMENT', 'FOLLOW_UP');

-- CreateTable
CREATE TABLE "journey_stages" (
    "key" "JourneyStageKey" NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journey_stages_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "patient_journeys" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "current_stage" "JourneyStageKey" NOT NULL DEFAULT 'DIAGNOSED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_journey_stage_history" (
    "id" UUID NOT NULL,
    "patient_journey_id" UUID NOT NULL,
    "from_stage" "JourneyStageKey" NOT NULL,
    "to_stage" "JourneyStageKey" NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_journey_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "journey_stages_order_key" ON "journey_stages"("order");

-- CreateIndex
CREATE INDEX "journey_stages_is_active_order_idx" ON "journey_stages"("is_active", "order");

-- CreateIndex
CREATE UNIQUE INDEX "patient_journeys_patient_id_key" ON "patient_journeys"("patient_id");

-- CreateIndex
CREATE INDEX "patient_journeys_current_stage_idx" ON "patient_journeys"("current_stage");

-- CreateIndex
CREATE INDEX "patient_journey_stage_history_patient_journey_id_changed_at_idx" ON "patient_journey_stage_history"("patient_journey_id", "changed_at");

-- AddForeignKey
ALTER TABLE "patient_journeys" ADD CONSTRAINT "patient_journeys_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_journeys" ADD CONSTRAINT "patient_journeys_current_stage_fkey" FOREIGN KEY ("current_stage") REFERENCES "journey_stages"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_journey_stage_history" ADD CONSTRAINT "patient_journey_stage_history_patient_journey_id_fkey" FOREIGN KEY ("patient_journey_id") REFERENCES "patient_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_journey_stage_history" ADD CONSTRAINT "patient_journey_stage_history_from_stage_fkey" FOREIGN KEY ("from_stage") REFERENCES "journey_stages"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_journey_stage_history" ADD CONSTRAINT "patient_journey_stage_history_to_stage_fkey" FOREIGN KEY ("to_stage") REFERENCES "journey_stages"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
