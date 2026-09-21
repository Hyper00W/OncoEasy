import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, LoadingState, Panel } from "../components/ui";
import {
  advanceJourney,
  getJourney,
  getJourneyStage,
  type JourneyStage,
  type JourneyStageKey,
  type PatientJourney
} from "../journey/journey-api";

type Navigate = (path: string) => void;

export function PatientJourneyPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [journey, setJourney] = useState<PatientJourney | null>(null);
  const [stageDetails, setStageDetails] = useState<JourneyStage | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getJourney()
      .then(setJourney)
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, []);

  function leave(): void {
    signOut();
    navigate("/");
  }

  function load(): void {
    setLoading(true);
    setError(null);
    getJourney()
      .then(setJourney)
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }

  function openStage(stage: JourneyStageKey): void {
    setDetailsLoading(true);
    setError(null);
    getJourneyStage(stage)
      .then(setStageDetails)
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setDetailsLoading(false));
  }

  function advance(stage: JourneyStageKey, title: string): void {
    setAdvancing(true);
    setError(null);
    advanceJourney(stage)
      .then(() => {
        setStageDetails(null);
        setNotice(`Your care journey advanced to ${title}.`);
        load();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setAdvancing(false));
  }

  if (!user) return null;

  const currentStage = journey?.currentStage ?? null;
  const stages = journey?.stages ?? [];
  const nextStage = currentStage
    ? stages.find((candidate) => candidate.order === currentStage.order + 1) ?? null
    : null;

  return (
    <main className="workspace-page consultation-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Patient care</p>
          <h1>Care journey</h1>
          <p className="intro">Follow your care stages and review the guidance published for each stage.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={leave}>Sign out</Button>
      </header>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}

      {loading ? (
        <LoadingState label="Loading your care journey..." />
      ) : (
        <section className="consultation-grid">
          <Panel>
            <h2>Current stage</h2>
            {currentStage ? (
              <>
                <p className="dashboard-value">{currentStage.title}</p>
                <p className="muted">{currentStage.description}</p>
                {asChecklist(currentStage.checklist).length > 0 ? (
                  <div className="stack-list">
                    {asChecklist(currentStage.checklist).map((item) => (
                      <p className="list-row" key={item}><span>{item}</span></p>
                    ))}
                  </div>
                ) : <p className="empty-state">No checklist is published for this stage.</p>}
                {nextStage ? (
                  <div className="button-row">
                    <Button type="button" disabled={advancing} onClick={() => advance(nextStage.stage, nextStage.title)}>
                      {advancing ? "Advancing..." : `Advance to ${nextStage.title}`}
                    </Button>
                  </div>
                ) : <p className="field-hint">You are in the final published stage of your care journey.</p>}
              </>
            ) : (
              <p className="empty-state">Your current stage content is not available yet.</p>
            )}
          </Panel>

          <Panel>
            <h2>Stages</h2>
            {stages.length === 0 ? (
              <p className="empty-state">No journey stages are published right now.</p>
            ) : (
              <div className="stack-list">
                {stages.map((stage) => (
                  <button className="list-row list-row-button" type="button" key={stage.stage} onClick={() => openStage(stage.stage)}>
                    <div>
                      <strong>{stage.order}. {stage.title}</strong>
                      <span className="muted">{formatStage(stage.stage)}</span>
                    </div>
                    {journey?.currentStageKey === stage.stage ? <span className="status">Current</span> : <span className="status">{stage.isActive ? "Published" : "Inactive"}</span>}
                  </button>
                ))}
              </div>
            )}
          </Panel>

          {detailsLoading ? <LoadingState label="Loading stage content..." /> : null}

          {stageDetails ? (
            <Panel>
              <div className="detail-header">
                <div>
                  <p className="eyebrow">{formatStage(stageDetails.stage)}</p>
                  <h2>{stageDetails.title}</h2>
                </div>
                <span className="status">Stage {stageDetails.order}</span>
              </div>
              <p className="muted">{stageDetails.description}</p>
              <h3>Checklist</h3>
              {asChecklist(stageDetails.checklist).length === 0 ? (
                <p className="empty-state">No checklist is published for this stage.</p>
              ) : (
                <div className="stack-list">
                  {asChecklist(stageDetails.checklist).map((item) => (
                    <p className="list-row" key={item}><span>{item}</span></p>
                  ))}
                </div>
              )}
              <div className="button-row">
                <Button className="button-secondary" type="button" onClick={() => setStageDetails(null)}>Close details</Button>
              </div>
            </Panel>
          ) : null}

          <Panel>
            <h2>Journey history</h2>
            {!journey || journey.history.length === 0 ? (
              <p className="empty-state">No journey updates recorded yet.</p>
            ) : (
              <div className="stack-list">
                {journey.history.map((entry) => (
                  <div className="list-row" key={`${entry.fromStage}-${entry.toStage}-${entry.changedAt}`}>
                    <div>
                      <strong>{formatStage(entry.fromStage)} → {formatStage(entry.toStage)}</strong>
                      <span className="muted">Updated {formatDate(entry.changedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>
      )}
    </main>
  );
}

function asChecklist(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatStage(value: string): string {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The care journey request could not be completed.";
}
