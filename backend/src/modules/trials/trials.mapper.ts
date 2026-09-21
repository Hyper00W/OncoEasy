type TrialRecord = {
  id: string;
  title: string;
  summary: string;
  description: string;
  source: string;
  sourceTrialId: string | null;
  sourceUrl: string | null;
  sponsor: string | null;
  location: string | null;
  status: string;
  eligibilitySummary: string | null;
  contactInformation: string | null;
  isPublished: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: { id: string; fullName: string };
  updatedBy?: { id: string; fullName: string } | null;
};

type InterestRecord = {
  id: string;
  trialId: string;
  patientId: string;
  notes: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  trial: TrialRecord;
  patient?: { id: string; fullName: string };
  updatedBy?: { id: string; fullName: string } | null;
};

export function toTrialResponse(trial: TrialRecord, includeAudit = false) {
  return {
    trialId: trial.id,
    title: trial.title,
    summary: trial.summary,
    description: trial.description,
    source: trial.source,
    sourceTrialId: trial.sourceTrialId,
    sourceUrl: trial.sourceUrl,
    sponsor: trial.sponsor,
    location: trial.location,
    status: trial.status,
    eligibilitySummary: trial.eligibilitySummary,
    contactInformation: trial.contactInformation,
    isPublished: trial.isPublished,
    publishedAt: trial.publishedAt?.toISOString() ?? null,
    createdAt: trial.createdAt.toISOString(),
    updatedAt: trial.updatedAt.toISOString(),
    ...(includeAudit ? {
      createdBy: trial.createdBy ? { userId: trial.createdBy.id, fullName: trial.createdBy.fullName } : null,
      updatedBy: trial.updatedBy ? { userId: trial.updatedBy.id, fullName: trial.updatedBy.fullName } : null
    } : {})
  };
}

export function toInterestResponse(interest: InterestRecord, includePatient = false) {
  return {
    interestId: interest.id,
    trial: toTrialResponse(interest.trial),
    notes: interest.notes,
    status: interest.status,
    createdAt: interest.createdAt.toISOString(),
    updatedAt: interest.updatedAt.toISOString(),
    ...(includePatient ? { patient: interest.patient ? { patientId: interest.patient.id, fullName: interest.patient.fullName } : null } : {})
  };
}
