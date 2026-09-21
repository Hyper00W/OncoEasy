import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";
import {
  getPublishedTrial,
  listMyTrialInterests,
  listPublishedTrials,
  submitTrialInterest,
  trialStatuses,
  type Trial,
  type TrialInterest,
  type TrialStatus
} from "../trials/trials-api";

type Navigate = (path: string) => void;

type TrialsQuery = {
  page: number;
  search: string;
  status: TrialStatus | "";
};

const pageSize = 10;

export function PatientTrialsPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [trials, setTrials] = useState<Trial[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize, total: 0, totalPages: 1 });
  const [trial, setTrial] = useState<Trial | null>(null);
  const [interests, setInterests] = useState<TrialInterest[]>([]);
  const [interestsLoaded, setInterestsLoaded] = useState(false);
  const [query, setQuery] = useState<TrialsQuery>({ page: 1, search: "", status: "" });
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [interestNotes, setInterestNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    listPublishedTrials({
      page: query.page,
      pageSize,
      search: query.search || undefined,
      status: query.status || undefined
    })
      .then((response) => {
        setTrials(response.items);
        setPagination(response.pagination);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, [query]);

  function leave(): void {
    signOut();
    navigate("/");
  }

  function loadInterests(): void {
    setError(null);
    listMyTrialInterests()
      .then((response) => {
        setInterests(response);
        setInterestsLoaded(true);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)));
  }

  function runQuery(next: TrialsQuery): void {
    setTrial(null);
    setError(null);
    setLoading(true);
    setQuery(next);
  }

  function applySearch(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    runQuery({ page: 1, search: searchInput.trim(), status: query.status });
  }

  function clearFilters(): void {
    setSearchInput("");
    runQuery({ page: 1, search: "", status: "" });
  }

  function openTrial(trialId: string): void {
    setDetailLoading(true);
    setError(null);
    setNotice(null);
    getPublishedTrial(trialId)
      .then(setTrial)
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setDetailLoading(false));
  }

  function expressInterest(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!trial) return;
    setSubmitting(true);
    setError(null);
    submitTrialInterest(trial.trialId, interestNotes.trim() || undefined)
      .then(() => {
        setNotice(`Interest submitted for "${trial.title}". The team may contact you about this study.`);
        setInterestNotes("");
        loadInterests();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSubmitting(false));
  }

  if (!user) return null;

  return (
    <main className="workspace-page consultation-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Research information</p>
          <h1>Clinical trials</h1>
          <p className="intro">Browse published clinical trial information and register your interest to be contacted. This information is educational and is not medical advice.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={leave}>Sign out</Button>
      </header>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}

      <section className="consultation-grid">
        <Panel>
          <h2>Search and filter</h2>
          <form className="form-stack" onSubmit={applySearch}>
            <Field label="Search trials" htmlFor="trials-search">
              <Input id="trials-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search title, summary, or description" />
            </Field>
            <Field label="Recruitment status" htmlFor="trials-status">
              <select className="input" id="trials-status" value={query.status} onChange={(event) => runQuery({ page: 1, search: query.search, status: event.target.value as TrialStatus | "" })}>
                <option value="">All statuses</option>
                {trialStatuses.map((value) => <option key={value} value={value}>{formatStatus(value)}</option>)}
              </select>
            </Field>
            <div className="button-row">
              <Button type="submit">Search</Button>
              <Button className="button-secondary" type="button" onClick={clearFilters}>Clear</Button>
              <Button className="button-secondary" type="button" onClick={loadInterests}>My interests</Button>
            </div>
          </form>
        </Panel>

        <Panel>
          <h2>Published trials</h2>
          {loading ? (
            <LoadingState label="Loading trials..." />
          ) : trials.length === 0 ? (
            <p className="empty-state">No published trials match your search.</p>
          ) : (
            <div className="stack-list">
              {trials.map((item) => (
                <button className="list-row list-row-button" type="button" key={item.trialId} onClick={() => openTrial(item.trialId)}>
                  <div>
                    <strong>{item.title}</strong>
                    <span className="muted">{formatStatus(item.status)}{item.sponsor ? ` • ${item.sponsor}` : ""}{item.location ? ` • ${item.location}` : ""}</span>
                    <span className="muted">{item.summary}</span>
                  </div>
                  <span className="status">View</span>
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

        {detailLoading ? <LoadingState label="Loading trial..." /> : null}

        {trial ? (
          <Panel>
            <div className="detail-header">
              <div>
                <p className="eyebrow">{formatStatus(trial.status)}</p>
                <h2>{trial.title}</h2>
              </div>
              {trial.sourceUrl ? <a className="button-link" href={trial.sourceUrl} target="_blank" rel="noreferrer">Source</a> : null}
            </div>
            <p className="muted">{trial.summary}</p>
            <p>{trial.description}</p>
            <div className="stack-list">
              {trial.sponsor ? <p className="list-row"><strong>Sponsor</strong><span>{trial.sponsor}</span></p> : null}
              {trial.location ? <p className="list-row"><strong>Location</strong><span>{trial.location}</span></p> : null}
              {trial.sourceTrialId ? <p className="list-row"><strong>Source identifier</strong><span>{trial.sourceTrialId}</span></p> : null}
              {trial.eligibilitySummary ? <p className="list-row"><strong>Eligibility summary</strong><span>{trial.eligibilitySummary}</span></p> : null}
              {trial.contactInformation ? <p className="list-row"><strong>Contact information</strong><span>{trial.contactInformation}</span></p> : null}
            </div>
            <p className="field-hint">Discuss any trial with your qualified care team before making decisions. Eligibility is decided by the study team, not by OncoEasy.</p>
            <form className="form-stack" onSubmit={expressInterest}>
              <Field label="Notes (optional)" htmlFor="trial-interest-notes" hint="Share anything the team should know, such as preferred contact times.">
                <textarea className="input textarea" id="trial-interest-notes" value={interestNotes} onChange={(event) => setInterestNotes(event.target.value)} />
              </Field>
              <div className="button-row">
                <Button type="submit" disabled={submitting}>{submitting ? "Submitting..." : "I am interested"}</Button>
                <Button className="button-secondary" type="button" onClick={() => setTrial(null)}>Close trial</Button>
              </div>
            </form>
          </Panel>
        ) : null}

        {interestsLoaded ? (
          <Panel>
            <h2>My trial interests</h2>
            {interests.length === 0 ? (
              <p className="empty-state">You have not expressed interest in any trials yet.</p>
            ) : (
              <div className="stack-list">
                {interests.map((interest) => (
                  <div className="list-row" key={interest.interestId}>
                    <div>
                      <strong>{interest.trial.title}</strong>
                      <span className="muted">Submitted {formatDate(interest.createdAt)}{interest.notes ? ` • ${interest.notes}` : ""}</span>
                    </div>
                    <span className="status">{formatStatus(interest.status)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        ) : null}
      </section>
    </main>
  );
}

function formatStatus(value: string): string {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The clinical trials request could not be completed.";
}
