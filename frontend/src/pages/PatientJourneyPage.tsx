import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PatientPageShell } from "../shell/PatientPageShell";
import { Alert, BackLink, Button, EmptyState, LoadingState, PageHero, Panel } from "../components/ui";
import { CareTimeline, CareTimelineStage } from "../components/compositions";
import { Reveal } from "../motion/motion";
import {
  advanceJourney,
  getJourney,
  getJourneyStage,
  type JourneyStage,
  type JourneyStageKey,
  type PatientJourney
} from "../journey/journey-api";
import { JourneyIcon } from "../components/icons";

type Navigate = (path: string) => void;

/**
 * Care journey (Phase 7). Same three API calls as before — the journey state,
 * the per-stage guidance, and the advance transition — rebuilt as an
 * editorial timeline: an animated connecting line, stage markers that record
 * progress, and a single visually dominant current stage.
 */
export function PatientJourneyPage({ navigate }: { navigate: Navigate }) {
  const { user } = useAuth();
  const [journey, setJourney] = useState<PatientJourney | null>(null);
  const [stageDetails, setStageDetails] = useState<JourneyStage | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getJourney()
      .then((response) => {
        if (!cancelled) setJourney(response);
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
    if (advancing) return; // one journey transition at a time
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
  const completedCount = currentStage ? Math.max(currentStage.order - 1, 0) : 0;

  return (
    <PatientPageShell
      navigate={navigate}
      activePath="/patient/journey"
      className="journey-page"
      backSlot={<BackLink navigate={navigate} fallback="/patient" label="Back to dashboard" />}
    >
      <PageHero
        tone="teal"
        eyebrow="Guided clinical pathway"
        title="Your oncology care journey,"
        highlight="step by step."
        description="Follow your active treatment milestones, clinical guidance, and recovery checklists. Clear visibility into where you stand and what comes next."
        image="/assets/banner/patient-care.jpg"
        imageAlt="Care team supporting a patient"
        badge={
          <>
            <JourneyIcon size={16} /> Clinical care pathway
          </>
        }
        crumbs={[{ label: "Dashboard", href: "/patient" }, { label: "Care journey" }]}
        action={
          journey && stages.length > 0 ? (
            <span className="journey-progress-summary">
              {completedCount} of {stages.length} stages complete
            </span>
          ) : undefined
        }
      />

      {error ? <Alert>{error}</Alert> : null}
      {notice ? (
        <div className="success-message" role="status">
          {notice}
        </div>
      ) : null}

      {loading ? (
        <div className="journey-loading">
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line" />
          <LoadingState label="Loading your care journey…" />
        </div>
      ) : (
        <section className="journey-page-grid">
          <div className="journey-page-main">
            {stages.length === 0 ? (
              <Panel className="panel-fluid">
                <EmptyState
                  icon={<JourneyIcon size={24} />}
                  title="No journey stages are published right now"
                  hint="Your care team publishes stage guidance here as your treatment plan develops."
                />
              </Panel>
            ) : (
              <Reveal className="journey-timeline-card">
                <div className="journey-timeline-head">
                  <p className="eyebrow">Your pathway</p>
                  <h2>Where you are now</h2>
                  <p>
                    Select any stage to read the guidance and checklist published for it. Your care team
                    confirms when a stage is complete.
                  </p>
                </div>

                <CareTimeline label="Care journey stages">
                  {stages.map((stage) => {
                    const isCurrent = journey?.currentStageKey === stage.stage;
                    const isDone = Boolean(currentStage) && stage.order < (currentStage?.order ?? 0);
                    return (
                      <CareTimelineStage
                        key={stage.stage}
                        order={stage.order}
                        title={stage.title}
                        meta={formatStage(stage.stage)}
                        description={isCurrent && currentStage ? currentStage.description : undefined}
                        state={isCurrent ? "current" : isDone ? "done" : "upcoming"}
                        onSelect={() => openStage(stage.stage)}
                        selectLabel={`Open guidance for ${stage.title}`}
                      />
                    );
                  })}
                </CareTimeline>
              </Reveal>
            )}

            {currentStage ? (
              <Reveal as="section" className="care-panel is-wide journey-current-panel" delay={80}>
                <div className="care-panel-head">
                  <h3>
                    <JourneyIcon size={16} /> Current stage
                  </h3>
                  <span className="journey-stage-here">You are here</span>
                </div>
                <p className="care-panel-primary">{currentStage.title}</p>
                <p className="care-panel-secondary">{currentStage.description}</p>

                {asChecklist(currentStage.checklist).length > 0 ? (
                  <ul className="journey-checklist">
                    {asChecklist(currentStage.checklist).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="care-panel-secondary">No checklist is published for this stage.</p>
                )}

                {nextStage ? (
                  <div className="journey-cta-row">
                    <Button type="button" disabled={advancing} onClick={() => advance(nextStage.stage, nextStage.title)}>
                      {advancing ? "Advancing…" : `Advance to ${nextStage.title}`}
                    </Button>
                    <p className="field-hint">Advance only when your care team confirms this step.</p>
                  </div>
                ) : (
                  <p className="field-hint">You are in the final published stage of your care journey.</p>
                )}
              </Reveal>
            ) : !loading && stages.length > 0 ? (
              <Panel className="panel-fluid">
                <p className="empty-state">Your current stage content is not available yet.</p>
              </Panel>
            ) : null}
          </div>

          <div className="journey-page-side">
            {detailsLoading ? <LoadingState label="Loading stage content…" /> : null}

            {stageDetails ? (
              <Panel className="panel-fluid">
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
                  <ul className="journey-checklist">
                    {asChecklist(stageDetails.checklist).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
                <div className="journey-cta-row">
                  <Button className="button-secondary" type="button" onClick={() => setStageDetails(null)}>
                    Close details
                  </Button>
                </div>
              </Panel>
            ) : !detailsLoading ? (
              <Panel className="panel-fluid">
                <h2>Stage guidance</h2>
                <p className="muted">
                  Select any stage on the timeline to read the guidance published for it.
                </p>
              </Panel>
            ) : null}

            <Panel className="panel-fluid">
              <h2>Journey history</h2>
              {!journey || journey.history.length === 0 ? (
                <p className="empty-state">No journey updates recorded yet.</p>
              ) : (
                <div className="stack-list">
                  {journey.history.map((entry) => (
                    <div className="list-row" key={`${entry.fromStage}-${entry.toStage}-${entry.changedAt}`}>
                      <div>
                        <strong>
                          {formatStage(entry.fromStage)} → {formatStage(entry.toStage)}
                        </strong>
                        <span className="muted">Updated {formatDate(entry.changedAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </section>
      )}
    </PatientPageShell>
  );
}

function asChecklist(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatStage(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The care journey request could not be completed.";
}
