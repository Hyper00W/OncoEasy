import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PatientPageShell } from "../shell/PatientPageShell";
import { Alert, BackLink, Button, EmptyState, Field, Input, LoadingState, PageHero, Panel } from "../components/ui";
import { FlaskIcon } from "../components/icons";
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
    const stale = false;

    listPublishedTrials({
      page: query.page,
      pageSize,
      search: query.search || undefined,
      status: query.status || undefined
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
  }, [query]);

  function leave(): void {
    signOut();
    navigate("/");
  }
  void leave;

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

  const detailRequestToken = useRef(0);

  function openTrial(trialId: string): void {
    const requestToken = ++detailRequestToken.current;
    setDetailLoading(true);
    setError(null);
    setNotice(null);
    getPublishedTrial(trialId)
      .then((trial) => {
        if (detailRequestToken.current !== requestToken) return; // a newer trial was opened
        setTrial(trial);
      })
      .catch((requestError: unknown) => {
        if (detailRequestToken.current === requestToken) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (detailRequestToken.current === requestToken) setDetailLoading(false);
      });
  }

  function expressInterest(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!trial || submitting) return; // one interest submission at a time
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

  const hasFilters = Boolean(query.search || query.status);

  return (
    <PatientPageShell
      navigate={navigate}
      activePath="/patient/trials"
      className="trials-page"
      backSlot={<BackLink navigate={navigate} fallback="/patient" label="Back to dashboard" />}
    >
      <PageHero
        tone="blue"
        eyebrow="Clinical Research &amp; Protocols"
        title="Oncology clinical trials,"
        highlight="novel treatments."
        description="Discover published clinical trials and research protocols investigating advanced oncology drugs and therapies. Register interest to connect with study teams."
        image="/assets/banner/specialty-medicines.jpg"
        imageAlt="Specialized clinical research medications"
        badge={
          <>
            <FlaskIcon size={16} /> Clinical Trials Directory
          </>
        }
        crumbs={[
          { label: "Dashboard", href: "/patient" },
          { label: "Clinical trials" }
        ]}
      />

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}

      <section className="consultation-grid">
        <Panel className="panel-fluid">
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

        <Panel className="panel-fluid">
          <h2>Published trials</h2>
          {loading ? (
            <LoadingState label="Loading trials..." />
          ) : trials.length === 0 ? (
            <EmptyState
              icon={<FlaskIcon size={22} />}
              title={hasFilters ? "No trials match your search" : "No trials are published yet"}
              hint={hasFilters ? "Try a different search term or recruitment status." : "Curated clinical trial listings will appear here as they are published."}
            />
          ) : (
            <div className="trial-list">
              {trials.map((item) => (
                <button className="trial-card" type="button" key={item.trialId} onClick={() => openTrial(item.trialId)}>
                  <span className="trial-card-head">
                    <span className="status">{formatStatus(item.status)}</span>
                    <span className="trial-card-arrow" aria-hidden="true">→</span>
                  </span>
                  <strong className="trial-card-title">{item.title}</strong>
                  {item.summary ? <span className="trial-card-summary">{item.summary}</span> : null}
                  {(item.sponsor || item.location) && (
                    <span className="trial-card-meta">
                      {item.sponsor ? <span>{item.sponsor}</span> : null}
                      {item.location ? <span>{item.location}</span> : null}
                    </span>
                  )}
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
          <Panel className="panel-fluid">
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

      <div className="disclaimer-band" role="note">
        <p>
          OncoEasy shares trial listings for education only. Eligibility is always confirmed by the
          study team after their own screening — never by OncoEasy. Talk with your care team before
          making any treatment decision.
        </p>
      </div>
    </PatientPageShell>
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
