import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PatientPageShell } from "../shell/PatientPageShell";
import {
  Alert,
  BackLink,
  Button,
  EmptyState,
  FeatureCard,
  Field,
  Input,
  LoadingState,
  PageHero,
  Panel,
  UploadZone
} from "../components/ui";
import { DocumentIcon, ShieldHeartIcon, SupportIcon } from "../components/icons";
import { StatusChip } from "../components/StatusChip";
import {
  createPapApplication,
  getPapApplication,
  getPapProgram,
  listPapApplications,
  listPapPrograms,
  uploadPapDocument,
  type PapApplication,
  type PapProgram
} from "../pap/pap-api";

type Navigate = (path: string) => void;

type ApplicationForm = {
  fullName: string;
  phone: string;
  address: string;
  diagnosisSummary: string;
  householdIncome: string;
  financialNeed: string;
};

const emptyForm: ApplicationForm = {
  fullName: "",
  phone: "",
  address: "",
  diagnosisSummary: "",
  householdIncome: "",
  financialNeed: ""
};

export function PatientPAPPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [programs, setPrograms] = useState<PapProgram[]>([]);
  const [applications, setApplications] = useState<PapApplication[]>([]);
  const [programDetails, setProgramDetails] = useState<PapProgram | null>(null);
  const [selectedProgram, setSelectedProgram] = useState<PapProgram | null>(null);
  const [selectedApplication, setSelectedApplication] = useState<PapApplication | null>(null);
  const [form, setForm] = useState<ApplicationForm>(emptyForm);
  const [document, setDocument] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([listPapPrograms(), listPapApplications()])
      .then(([programResponse, applicationResponse]) => {
        if (cancelled) return;
        setPrograms(programResponse);
        setApplications(applicationResponse);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function leave(): void {
    signOut();
    navigate("/");
  }
  void leave;

  function refreshApplications(): void {
    listPapApplications()
      .then(setApplications)
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)));
  }

  function openProgram(programId: string): void {
    setError(null);
    getPapProgram(programId)
      .then(setProgramDetails)
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)));
  }

  function selectProgram(program: PapProgram): void {
    setSelectedProgram(program);
    setProgramDetails(null);
    setSelectedApplication(null);
    setForm(emptyForm);
    setError(null);
    setNotice(null);
  }

  function openApplication(applicationId: string): void {
    setError(null);
    getPapApplication(applicationId)
      .then(setSelectedApplication)
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)));
  }

  function submitApplication(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!selectedProgram || submitting) return;

    setSubmitting(true);
    setError(null);
    createPapApplication({ papProgramId: selectedProgram.programId, applicationData: form })
      .then((application) => {
        setNotice("Your PAP application was submitted for manual review.");
        setSelectedApplication(application);
        setSelectedProgram(null);
        setForm(emptyForm);
        refreshApplications();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSubmitting(false));
  }

  function uploadDocument(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!selectedApplication || !document || uploading) return;

    setUploading(true);
    setError(null);
    uploadPapDocument(selectedApplication.applicationId, document)
      .then(() => getPapApplication(selectedApplication.applicationId))
      .then((application) => {
        setSelectedApplication(application);
        setDocument(null);
        setNotice("Document uploaded to your application.");
        refreshApplications();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setUploading(false));
  }

  if (!user) return null;

  return (
    <PatientPageShell navigate={navigate} activePath="/patient/pap" className="pap-page"
      backSlot={<BackLink navigate={navigate} fallback="/patient" label="Back to dashboard" />}>
      <PageHero
        tone="cream"
        eyebrow="Patient support"
        title="Patient assistance programs,"
        highlight="care beyond cost."
        description="Patient assistance programs can reduce the cost of long-term therapy. Explore available programs, apply with guided steps, and track your review."
        image="/assets/banner/patient-care.jpg"
        imageAlt="A care provider supporting a patient"
        badge={
          <>
            <ShieldHeartIcon size={16} /> Confidential Review
          </>
        }
        crumbs={[
          { label: "Dashboard", href: "/patient" },
          { label: "Patient assistance" }
        ]}
      />

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}

      {loading ? <LoadingState label="Loading PAP programs..." /> : (
        <section className="pap-grid">
          <Panel className="panel-fluid">
            <h2>Available programs</h2>
            {programs.length === 0 ? (
              <EmptyState icon={<ShieldHeartIcon size={22} />} title="No support programs are available right now" hint="New assistance programs will appear here as they become available." />
            ) : (
              <div className="pap-program-grid">
                {programs.map((program) => (
                  <FeatureCard
                    key={program.programId}
                    icon={<ShieldHeartIcon size={20} />}
                    tone="teal"
                    title={program.name}
                    description={program.description}
                    action={
                      <div className="button-row">
                        <Button className="button-secondary" type="button" onClick={() => openProgram(program.programId)}>Details</Button>
                        <Button type="button" onClick={() => selectProgram(program)}>Apply</Button>
                      </div>
                    }
                  />
                ))}
              </div>
            )}
          </Panel>

          {programDetails ? (
            <Panel>
              <h2>{programDetails.name}</h2>
              <p>{programDetails.description}</p>
              <p className="muted">{programDetails.eligibilityDescription}</p>
              <p className="field-hint">Required documents: {formatRequirements(programDetails.requiredDocuments)}</p>
              <div className="button-row">
                <Button type="button" onClick={() => selectProgram(programDetails)}>Apply for this program</Button>
                <Button className="button-secondary" type="button" onClick={() => setProgramDetails(null)}>Close details</Button>
              </div>
            </Panel>
          ) : null}

          <Panel className="panel-fluid">
            <h2>My applications</h2>
            {applications.length === 0 ? (
              <EmptyState icon={<DocumentIcon size={22} />} title="You have not submitted a PAP application" hint="Explore the programs and apply — your application status will be tracked here." />
            ) : (
              <div className="stack-list">
                {applications.map((application) => (
                  <button className="list-row list-row-button" type="button" key={application.applicationId} onClick={() => openApplication(application.applicationId)}>
                    <div>
                      <strong>{application.program.name}</strong>
                      <span className="muted">Submitted {formatDate(application.createdAt)}</span>
                    </div>
                    <StatusChip status={application.status} />
                  </button>
                ))}
              </div>
            )}
          </Panel>

          {selectedProgram ? (
            <Panel>
              <h2>Apply for {selectedProgram.name}</h2>
              <p className="muted">{selectedProgram.eligibilityDescription}</p>
              <p className="field-hint">Required documents: {formatRequirements(selectedProgram.requiredDocuments)}</p>
              <form className="form-stack" onSubmit={submitApplication}>
                <Field label="Full name" htmlFor="pap-full-name"><Input id="pap-full-name" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required /></Field>
                <Field label="Phone" htmlFor="pap-phone"><Input id="pap-phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} required /></Field>
                <Field label="Address" htmlFor="pap-address"><textarea className="input textarea" id="pap-address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} required /></Field>
                <Field label="Diagnosis summary" htmlFor="pap-diagnosis"><textarea className="input textarea" id="pap-diagnosis" value={form.diagnosisSummary} onChange={(event) => setForm({ ...form, diagnosisSummary: event.target.value })} required /></Field>
                <Field label="Household income" htmlFor="pap-income"><Input id="pap-income" value={form.householdIncome} onChange={(event) => setForm({ ...form, householdIncome: event.target.value })} required /></Field>
                <Field label="Financial need" htmlFor="pap-need"><textarea className="input textarea" id="pap-need" value={form.financialNeed} onChange={(event) => setForm({ ...form, financialNeed: event.target.value })} required /></Field>
                <div className="button-row"><Button type="submit" disabled={submitting}>{submitting ? "Submitting..." : "Submit application"}</Button><Button className="button-secondary" type="button" onClick={() => setSelectedProgram(null)}>Cancel</Button></div>
              </form>
            </Panel>
          ) : null}

          {selectedApplication ? (
            <ApplicationDetail application={selectedApplication} document={document} uploading={uploading} onDocumentChange={setDocument} onUpload={uploadDocument} onClose={() => setSelectedApplication(null)} />
          ) : null}
        </section>
      )}

      <section className="cta-section section-cream" aria-label="Need help with assistance programs">
        <div>
          <h2>Need help with an application?</h2>
          <p>Our patient support desk can walk you through eligibility, documents, and program timelines.</p>
        </div>
        <Button type="button" onClick={() => navigate("/patient/chat")}>
          <SupportIcon size={16} /> Contact patient support
        </Button>
      </section>
    </PatientPageShell>
  );
}

function ApplicationDetail({ application, document, uploading, onDocumentChange, onUpload, onClose }: { application: PapApplication; document: File | null; uploading: boolean; onDocumentChange: (file: File | null) => void; onUpload: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  return (
    <Panel>
      <div className="detail-header"><div><h2>Application details</h2><p className="muted">{application.program.name}</p></div><StatusChip status={application.status} /></div>
      <dl className="detail-list">
        <dt>Submitted</dt><dd>{formatDate(application.createdAt)}</dd>
        <dt>Address</dt><dd>{application.applicationData.address}</dd>
        <dt>Diagnosis summary</dt><dd>{application.applicationData.diagnosisSummary}</dd>
        <dt>Household income</dt><dd>{application.applicationData.householdIncome}</dd>
        <dt>Financial need</dt><dd>{application.applicationData.financialNeed}</dd>
      </dl>
      {application.reviewReason ? <div className="alert">Review reason: {application.reviewReason}</div> : null}
      {application.reviewNotes ? <p className="muted">Review notes: {application.reviewNotes}</p> : null}
      <h3>Documents</h3>
      {application.documents.length === 0 ? <p className="empty-state">No documents uploaded yet.</p> : <div className="stack-list">{application.documents.map((item) => <div className="list-row" key={item.documentId}><div><strong>{item.documentName}</strong><span className="muted">{item.mimeType} • {formatDate(item.uploadedAt)}</span></div></div>)}</div>}
      {application.status !== "REJECTED" && application.status !== "COMPLETED" ? (
        <form className="form-stack" onSubmit={onUpload}>
          <UploadZone
            id="pap-document"
            label="Select a supporting document"
            hint="PDF, JPG, PNG, or WebP — prescriptions, income proof, or identity documents"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            file={document}
            onChange={onDocumentChange}
            required
          />
          <Button type="submit" disabled={!document || uploading}>{uploading ? "Uploading..." : "Upload document"}</Button>
        </form>
      ) : null}
      <Button className="button-secondary" type="button" onClick={onClose}>Close details</Button>
    </Panel>
  );
}

function formatRequirements(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : "See program requirements";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The PAP request could not be completed.";
}
