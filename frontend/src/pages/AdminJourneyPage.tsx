import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";
import {
  listAdminJourneyStages,
  updateAdminJourneyStage,
  type JourneyStage,
  type JourneyStageKey
} from "../journey/journey-api";

type Navigate = (path: string) => void;

export function AdminJourneyPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [stages, setStages] = useState<JourneyStage[]>([]);
  const [selected, setSelected] = useState<JourneyStage | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [checklistText, setChecklistText] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    listAdminJourneyStages()
      .then((response) => {
        setStages(response);
        if (response[0]) selectStage(response[0]);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, []);

  function leave(): void {
    signOut();
    navigate("/");
  }

  function load(): void {
    listAdminJourneyStages()
      .then((response) => {
        setStages(response);
        if (selected) {
          const next = response.find((stage) => stage.stage === selected.stage);
          if (next) selectStage(next);
        }
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)));
  }

  function selectStage(stage: JourneyStage): void {
    setSelected(stage);
    setTitle(stage.title);
    setDescription(stage.description);
    setChecklistText(asChecklist(stage.checklist).join("\n"));
    setIsActive(stage.isActive);
    setError(null);
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!selected) return;
    if (!title.trim() || !description.trim()) {
      setError("Stage title and description are required.");
      return;
    }

    setSaving(true);
    setError(null);
    updateAdminJourneyStage(selected.stage as JourneyStageKey, {
      title: title.trim(),
      description: description.trim(),
      checklist: checklistText.split("\n").map((item) => item.trim()).filter(Boolean),
      isActive
    })
      .then((stage) => {
        setSelected(stage);
        setNotice(`Stage content saved for ${stage.title}.`);
        load();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSaving(false));
  }

  if (!user) return null;

  return (
    <main className="workspace-page consultation-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Operations admin</p>
          <h1>Journey stages</h1>
          <p className="intro">Review and publish the content patients see for each care stage.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={leave}>Sign out</Button>
      </header>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}

      {loading ? (
        <LoadingState label="Loading journey stages..." />
      ) : (
        <section className="consultation-grid">
          <Panel>
            <h2>Stage content</h2>
            {stages.length === 0 ? (
              <p className="empty-state">No journey stages are configured.</p>
            ) : (
              <div className="stack-list">
                {stages.map((stage) => (
                  <button className="list-row list-row-button" type="button" key={stage.stage} onClick={() => selectStage(stage)}>
                    <div>
                      <strong>{stage.order}. {stage.title}</strong>
                      <span className="muted">{formatStage(stage.stage)}</span>
                    </div>
                    <span className="status">{stage.isActive ? "Active" : "Inactive"}</span>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          {selected ? (
            <Panel>
              <h2>{formatStage(selected.stage)}</h2>
              <p className="muted">Order {selected.order} • Last updated {formatDate(selected.updatedAt)}</p>
              <form className="form-stack" onSubmit={save}>
                <Field label="Title" htmlFor="journey-title">
                  <Input id="journey-title" value={title} onChange={(event) => setTitle(event.target.value)} />
                </Field>
                <Field label="Description" htmlFor="journey-description">
                  <textarea className="input textarea" id="journey-description" value={description} onChange={(event) => setDescription(event.target.value)} />
                </Field>
                <Field label="Checklist (one item per line)" htmlFor="journey-checklist">
                  <textarea className="input textarea" id="journey-checklist" value={checklistText} onChange={(event) => setChecklistText(event.target.value)} />
                </Field>
                <Field label="Publication" htmlFor="journey-active">
                  <select className="input" id="journey-active" value={isActive ? "true" : "false"} onChange={(event) => setIsActive(event.target.value === "true")}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </Field>
                <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save stage content"}</Button>
              </form>
            </Panel>
          ) : null}
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
  return error instanceof ApiError ? error.message : "The journey content request could not be completed.";
}
