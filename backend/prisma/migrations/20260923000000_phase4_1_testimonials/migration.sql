-- CreateEnum
CREATE TYPE "TestimonialType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateTable
CREATE TABLE "testimonials" (
    "id" UUID NOT NULL,
    "type" "TestimonialType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "media_storage_key" TEXT,
    "media_document_name" TEXT,
    "media_mime_type" TEXT,
    "media_checksum" TEXT,
    "media_uploaded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "testimonials_published_display_order_created_at_idx" ON "testimonials"("published", "display_order", "created_at");
