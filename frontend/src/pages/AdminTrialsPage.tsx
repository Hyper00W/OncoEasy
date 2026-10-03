import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AdminPortalShell } from "../admin/AdminPortalShell";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";
import {
  createTrial,
  listAdminTrialInterests,
  listAdminTrials,
  setTrialInterestStatus,
  setTrialPublished,
  trialInterestStatuses,
  trialSources,
  trialStatuses,
  updateTrial,
  type AdminTrial,
  type AdminTrialInterest,
  type CreateTrialInput,
  type TrialInterestStatus,
  type TrialSource,
  type TrialStatus
} from "../trials/trials-api";

type Navigate = (path: string) => void;
type PublishedFilter = "ALL" | "PUBLISHED" | "UNPUBLISHED";

type AdminTrialsQuery = {
  page: number;
  search: string;
  status: TrialStatus | "";
  published: PublishedFilter;
};

const pageSize = 10;

const emptyForm = {
  title: "",
  summary: "",
  description: "",
  source: "OTHER" as TrialSource,
  sourceTrialId: "",
  sourceUrl: "",
  sponsor: "",
  location: "",
  status: "NOT_YET_RECRUITING" as TrialStatus,
  eligibilitySummary: "",
  contactInformation: "",
  isPublished: false
};

export function AdminTrialsPage({ navigate }: { navigate: Navigate }) {
  const { user } = useAuth();
  const [trials, setTrials] = useState<AdminTrial[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize, total: 0, totalPages: 1 });
  const [selected, setSelected] = useState<AdminTrial | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [interests, setInterests] = useState<AdminTrialInterest[]>([]);
  const [interestsLoading, setInterestsLoading] = useState(true);
  const [interestPage, setInterestPage] = useState(1);
  const [interestPagination, setInterestPagination] = useState({ page: 1, pageSize, total: 0, totalPages: 1 });
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<TrialStatus | "">("");
  const [publishedFilter, setPublishedFilter] = useState<PublishedFilter>("ALL");
  const [query, setQuery] = useState<AdminTrialsQuery>({ page: 1, search: "", status: "", published: "ALL" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;

    listAdminTrials({
      page: query.page,
      pageSize,
      search: query.search || undefined,
      status: query.status || undefined,
      isPublished: query.published === "ALL" ? undefined : query.published === "PUBLISHED"
    })
      .then((response) => {
        if (stale) return; // a newer query superseded this response
        setTrials(response.items);
        setPagination(response.pagination);
      })
      .catch((requestError: unknown) => {
        if (!stale) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });

    return () => {
      stale = true;
    };
  }, [query]);

  useEffect(() => {
    let stale = false;

    listAdminTrialInterests({ page: interestPage, pageSize })
      .then((response) => {
        if (stale) return; // a newer page superseded this response
        setInterests(response.items);
        setInterestPagination(response.pagination);
      })
      .catch((requestError: unknown) => {
        if (!stale) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (!stale) setInterestsLoading(false);
      });

    return () => {
      stale = true;
    };
  }, [interestPage]);

  function changeInterestPage(delta: number): void {
    setInterestsLoading(true);
    setInterestPage((current) => current + delta);
  }

  function runQuery(next: AdminTrialsQuery): void {
    setError(null);
    setLoading(true);
    setQuery(next);
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    runQuery({ page: 1, search: searchInput.trim(), status: statusFilter, published: publishedFilter });
  }

  function resetForm(): void {
    setForm(emptyForm);
    setError(null);
  }

  function startCreate(): void {
    setCreating(true);
    setSelected(null);
    resetForm();
    setNotice(null);
  }

  function openTrial(trial: AdminTrial): void {
    setCreating(false);
    setSelected(trial);
    setForm({
      title: trial.title,
      summary: trial.summary,
      description: trial.description,
      source: trial.source,
      sourceTrialId: trial.sourceTrialId ?? "",
      sourceUrl: trial.sourceUrl ?? "",
      sponsor: trial.sponsor ?? "",
      location: trial.location ?? "",
      status: trial.status,
      eligibilitySummary: trial.eligibilitySummary ?? "",
      contactInformation: trial.contactInformation ?? "",
      isPublished: trial.isPublished
    });
    setError(null);
  }

  function toInput(): CreateTrialInput {
    return {
      title: form.title.trim(),
      summary: form.summary.trim(),
      description: form.description.trim(),
      source: form.source,
      sourceTrialId: form.sourceTrialId.trim() || null,
      sourceUrl: form.sourceUrl.trim() || null,
      sponsor: form.sponsor.trim() || null,
      location: form.location.trim() || null,
      status: form.status,
      eligibilitySummary: form.eligibilitySummary.trim() || null,
      contactInformation: form.contactInformation.trim() || null
    };
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!form.title.trim() || !form.summary.trim() || !form.description.trim()) {
      setError("Title, summary, and description are required.");
      return;
    }

    setSaving(true);
    setError(null);
    const request = creating || !selected
      ? createTrial({ ...toInput(), isPublished: form.isPublished })
      : updateTrial(selected.trialId, toInput());

    request
      .then((trial) => {
        const wasCreating = creating;
        openTrial(trial);
        setNotice(wasCreating ? `Trial created: ${trial.title}.` : `Trial saved: ${trial.title}.`);
        runQuery({ ...query });
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSaving(false));
  }

  function togglePublished(): void {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setTrialPublished(selected.trialId, !selected.isPublished)
      .then((trial) => {
        openTrial(trial);
        setNotice(`Trial ${trial.isPublished ? "published" : "unpublished"}: ${trial.title}.`);
        runQuery({ ...query });
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSaving(false));
  }

  function changeInterestStatus(interest: AdminTrialInterest, status: TrialInterestStatus): void {
    setError(null);
    setTrialInterestStatus(interest.interestId, status)
      .then((updated) => {
        setInterests((current) => current.map((item) => (item.interestId === updated.interestId ? updated : item)));
        setNotice(`Interest status updated to ${formatLabel(updated.status)}.`);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)));
  }

  if (!user) return null;

  return (
    <AdminPortalShell
      navigate={navigate}
      activePath="/admin/trials"
      title="Clinical trials"
      actions={<Button type="button" onClick={startCreate}>New trial</Button>}
    >
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}

      <section className="consultation-grid">
        <Panel>
          <div className="detail-header">
            <h2>Trials</h2>
          </div>
          <form className="form-stack" onSubmit={applyFilters}>
            <Field label="Search trials" htmlFor="trials-admin-search">
              <Input id="trials-admin-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search title, summary, or description" />
            </Field>
            <Field label="Recruitment status" htmlFor="trials-admin-status">
              <select className="input" id="trials-admin-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as TrialStatus | "")}>
                <option value="">All statuses</option>
                {trialStatuses.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}
              </select>
            </Field>
            <Field label="Publication" htmlFor="trials-admin-published">
              <select className="input" id="trials-admin-published" value={publishedFilter} onChange={(event) => setPublishedFilter(event.target.value as PublishedFilter)}>
                <option value="ALL">All trials</option>
                <option value="PUBLISHED">Published only</option>
                <option value="UNPUBLISHED">Unpublished only</option>
              </select>
            </Field>
            <Button type="submit">Apply filters</Button>
          </form>

          {loading ? (
            <LoadingState label="Loading trials..." />
          ) : trials.length === 0 ? (
            <p className="empty-state">No trials match the current filters.</p>
          ) : (
            <div className="stack-list">
              {trials.map((trial) => (
                <button className="list-row list-row-button" type="button" key={trial.trialId} onClick={() => openTrial(trial)}>
                  <div>
                    <strong>{trial.title}</strong>
                    <span className="muted">{formatLabel(trial.status)}{trial.sponsor ? ` • ${trial.sponsor}` : ""}</span>
                  </div>
                  <span className="status">{trial.isPublished ? "Published" : "Draft"}</span>
                </button>
              ))}
            </div>
          )}

          <div className="button-row">
            <Button className="button-secondary" type="button" disabled={loading || pagination.page <= 1} onClick={() => runQuery({ ...query, page: pagination.page - 1 })}>Previous</Button>
            <span className="field-hint">Page {pagination.page} of {Math.max(pagination.totalPages, 1)} • {pagination.total} trial(s)</span>
            <Button className="button-secondary" type="button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => runQuery({ ...query, page: pagination.page + 1 })}>Next</Button>
          </div>
        </Panel>

        {creating || selected ? (
          <Panel>
            <h2>{creating ? "New trial" : "Edit trial"}</h2>
            {selected ? (
              <p className="muted">
                {selected.isPublished ? "Published" : "Draft"}
                {selected.updatedBy ? ` • Last updated by ${selected.updatedBy.fullName}` : ""}
              </p>
            ) : null}
            <form className="form-stack" onSubmit={save}>
              <Field label="Title" htmlFor="trial-title">
                <Input id="trial-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
              </Field>
              <Field label="Summary" htmlFor="trial-summary">
                <textarea className="input textarea" id="trial-summary" value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} />
              </Field>
              <Field label="Description" htmlFor="trial-description">
                <textarea className="input textarea" id="trial-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              </Field>
              <Field label="Source" htmlFor="trial-source">
                <select className="input" id="trial-source" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value as TrialSource })}>
                  {trialSources.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}
                </select>
              </Field>
              <Field label="Source identifier" htmlFor="trial-source-id" hint="Optional registry identifier, e.g. CTRI or ClinicalTrials.gov number.">
                <Input id="trial-source-id" value={form.sourceTrialId} onChange={(event) => setForm({ ...form, sourceTrialId: event.target.value })} />
              </Field>
              <Field label="Source URL" htmlFor="trial-source-url" hint="Optional link to the registry page.">
                <Input id="trial-source-url" value={form.sourceUrl} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} placeholder="https://..." />
              </Field>
              <Field label="Sponsor" htmlFor="trial-sponsor">
                <Input id="trial-sponsor" value={form.sponsor} onChange={(event) => setForm({ ...form, sponsor: event.target.value })} />
              </Field>
              <Field label="Location" htmlFor="trial-location">
                <Input id="trial-location" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} />
              </Field>
              <Field label="Recruitment status" htmlFor="trial-status">
                <select className="input" id="trial-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as TrialStatus })}>
                  {trialStatuses.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}
                </select>
              </Field>
              <Field label="Eligibility summary" htmlFor="trial-eligibility" hint="Optional. Describe eligibility as provided by the study, not medical advice.">
                <textarea className="input textarea" id="trial-eligibility" value={form.eligibilitySummary} onChange={(event) => setForm({ ...form, eligibilitySummary: event.target.value })} />
              </Field>
              <Field label="Contact information" htmlFor="trial-contact">
                <textarea className="input textarea" id="trial-contact" value={form.contactInformation} onChange={(event) => setForm({ ...form, contactInformation: event.target.value })} />
              </Field>
              {creating ? (
                <Field label="Publication" htmlFor="trial-published">
                  <select className="input" id="trial-published" value={form.isPublished ? "true" : "false"} onChange={(event) => setForm({ ...form, isPublished: event.target.value === "true" })}>
                    <option value="false">Save as draft</option>
                    <option value="true">Publish now</option>
                  </select>
                </Field>
              ) : null}
              <div className="button-row">
                <Button type="submit" disabled={saving}>{saving ? "Saving..." : creating ? "Create trial" : "Save changes"}</Button>
                {selected ? (
                  <Button className="button-secondary" type="button" disabled={saving} onClick={togglePublished}>
                    {selected.isPublished ? "Unpublish" : "Publish"}
                  </Button>
                ) : null}
                <Button className="button-secondary" type="button" onClick={() => { setCreating(false); setSelected(null); resetForm(); }}>Cancel</Button>
              </div>
            </form>
          </Panel>
        ) : null}

        <Panel>
          <h2>Trial interest queue</h2>
          {interestsLoading ? (
            <LoadingState label="Loading interests..." />
          ) : interests.length === 0 ? (
            <p className="empty-state">No trial interest submissions yet.</p>
          ) : (
            <div className="stack-list">
              {interests.map((interest) => (
                <div className="list-row" key={interest.interestId}>
                  <div>
                    <strong>{interest.trial.title}</strong>
                    <span className="muted">{interest.patient?.fullName ?? "Patient"} • Submitted {formatDate(interest.createdAt)}</span>
                    {interest.notes ? <span className="muted">Notes: {interest.notes}</span> : null}
                  </div>
                  <select className="input" aria-label="Interest status" value={interest.status} onChange={(event) => changeInterestStatus(interest, event.target.value as TrialInterestStatus)}>
                    {trialInterestStatuses.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
          <div className="button-row">
            <Button className="button-secondary" type="button" disabled={interestsLoading || interestPagination.page <= 1} onClick={() => changeInterestPage(-1)}>Previous</Button>
            <span className="field-hint">Page {interestPagination.page} of {Math.max(interestPagination.totalPages, 1)} • {interestPagination.total} interest(s)</span>
            <Button className="button-secondary" type="button" disabled={interestsLoading || interestPagination.page >= interestPagination.totalPages} onClick={() => changeInterestPage(1)}>Next</Button>
          </div>
        </Panel>
      </section>
    </AdminPortalShell>
  );
}

function formatLabel(value: string): string {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The clinical trials request could not be completed.";
}
