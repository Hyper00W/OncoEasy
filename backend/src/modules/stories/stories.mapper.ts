type StoryRecord = {
  id: string;
  displayName: string;
  story: string;
  photoDocumentName: string | null;
  photoMimeType: string | null;
  consentGiven: boolean;
  consentTextVersion?: string | null;
  status: string;
  isPublished: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: { id: string; fullName: string };
  updatedBy?: { id: string; fullName: string } | null;
};

export function toPublicStory(story: StoryRecord, photoAccess?: { reference: string; expiresAt: Date }) {
  return {
    storyId: story.id,
    displayName: story.displayName,
    story: story.story,
    photo: story.photoDocumentName && photoAccess ? { documentName: story.photoDocumentName, mimeType: story.photoMimeType, access: { reference: photoAccess.reference, expiresAt: photoAccess.expiresAt.toISOString() } } : null,
    publishedAt: story.publishedAt?.toISOString() ?? null
  };
}

export function toAdminStory(story: StoryRecord) {
  return {
    storyId: story.id,
    displayName: story.displayName,
    story: story.story,
    photo: story.photoDocumentName ? { documentName: story.photoDocumentName, mimeType: story.photoMimeType } : null,
    consentGiven: story.consentGiven,
    consentTextVersion: story.consentTextVersion,
    status: story.status,
    isPublished: story.isPublished,
    publishedAt: story.publishedAt?.toISOString() ?? null,
    createdBy: story.createdBy ? { userId: story.createdBy.id, fullName: story.createdBy.fullName } : null,
    updatedBy: story.updatedBy ? { userId: story.updatedBy.id, fullName: story.updatedBy.fullName } : null,
    createdAt: story.createdAt.toISOString(),
    updatedAt: story.updatedAt.toISOString()
  };
}
