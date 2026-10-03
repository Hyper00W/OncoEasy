export type TestimonialRecord = {
  id: string;
  type: "IMAGE" | "VIDEO";
  title: string;
  description: string;
  displayName: string;
  displayOrder: number;
  published: boolean;
  publishedAt: Date | null;
  mediaStorageKey: string | null;
  mediaDocumentName: string | null;
  mediaMimeType: string | null;
  mediaChecksum: string | null;
  mediaUploadedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MediaAccess = {
  reference: string;
  expiresAt: Date;
};

/**
 * Media is delivered through the backend so browsers never see storage keys and
 * development (in-memory storage) works too. The version parameter changes when
 * media is replaced, so caches never serve a stale file.
 */
function mediaDeliveryUrl(testimonial: Pick<TestimonialRecord, "id" | "mediaStorageKey" | "mediaUploadedAt" | "createdAt">, audience: "public" | "admin") {
  if (!testimonial.mediaStorageKey) return null;
  const version = (testimonial.mediaUploadedAt ?? testimonial.createdAt).getTime();
  const path = audience === "public"
    ? `/api/v1/testimonials/${testimonial.id}/media`
    : `/api/v1/admin/testimonials/${testimonial.id}/media`;
  return `${path}?v=${version}`;
}

function mediaMetadata(
  testimonial: Pick<TestimonialRecord, "id" | "mediaStorageKey" | "mediaDocumentName" | "mediaMimeType" | "mediaChecksum" | "mediaUploadedAt" | "createdAt">,
  audience: "public" | "admin"
) {
  if (!testimonial.mediaDocumentName) return null;
  return {
    documentName: testimonial.mediaDocumentName,
    mimeType: testimonial.mediaMimeType,
    checksum: testimonial.mediaChecksum,
    uploadedAt: testimonial.mediaUploadedAt?.toISOString() ?? null,
    deliveryUrl: mediaDeliveryUrl(testimonial, audience)
  };
}

/** Public shape: only admin-entered display fields plus temporary media access. Never storage keys. */
export function toPublicTestimonial(testimonial: TestimonialRecord, mediaAccess?: MediaAccess) {
  const metadata = mediaMetadata(testimonial, "public");
  return {
    testimonialId: testimonial.id,
    type: testimonial.type,
    title: testimonial.title,
    description: testimonial.description,
    displayName: testimonial.displayName,
    displayOrder: testimonial.displayOrder,
    published: testimonial.published,
    media: metadata
      ? {
          ...metadata,
          access: mediaAccess ? { reference: mediaAccess.reference, expiresAt: mediaAccess.expiresAt.toISOString() } : null
        }
      : null,
    publishedAt: testimonial.publishedAt?.toISOString() ?? null,
    createdAt: testimonial.createdAt.toISOString(),
    updatedAt: testimonial.updatedAt.toISOString()
  };
}

/** Admin shape: metadata without any storage key, mirroring the PatientStories admin mapper. */
export function toAdminTestimonial(testimonial: TestimonialRecord) {
  return {
    testimonialId: testimonial.id,
    type: testimonial.type,
    title: testimonial.title,
    description: testimonial.description,
    displayName: testimonial.displayName,
    displayOrder: testimonial.displayOrder,
    published: testimonial.published,
    publishedAt: testimonial.publishedAt?.toISOString() ?? null,
    media: mediaMetadata(testimonial, "admin"),
    createdAt: testimonial.createdAt.toISOString(),
    updatedAt: testimonial.updatedAt.toISOString()
  };
}
