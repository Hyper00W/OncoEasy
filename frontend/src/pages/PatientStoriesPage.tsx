import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, LoadingState, Panel } from "../components/ui";
import {
  getPublishedStory,
  listPublishedStories,
  type PublishedStory
} from "../stories/stories-api";

type Navigate = (path: string) => void;

const pageSize = 10;

export function PatientStoriesPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [stories, setStories] = useState<PublishedStory[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PublishedStory | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    listPublishedStories({ page, pageSize })
      .then((response) => {
        if (cancelled) return;
        setStories(response.items);
        setPagination(response.pagination);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, reloadToken]);

  function leave(): void {
    signOut();
    navigate("/");
  }

  function openStory(storyId: string): void {
    setDetailLoading(true);
    setError(null);
    getPublishedStory(storyId)
      .then((story) => {
        setSelected(story);
        window.scrollTo({ top: 0, behavior: "smooth" });
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setDetailLoading(false));
  }

  function changePage(delta: number): void {
    setLoading(true);
    setSelected(null);
    setPage((current) => current + delta);
  }

  function retry(): void {
    setError(null);
    setLoading(true);
    setReloadToken((current) => current + 1);
  }

  if (!user) return null;

  return (
    <main className="workspace-page consultation-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Patient community</p>
          <h1>Patient stories</h1>
          <p className="intro">Read experiences shared by patients who have given their consent to publish. Stories are shared for support and hope, not medical advice.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={leave}>Sign out</Button>
      </header>

      {error ? (
        <>
          <Alert>{error}</Alert>
          <Button type="button" onClick={retry}>Retry</Button>
        </>
      ) : null}

      {detailLoading ? <LoadingState label="Loading story..." /> : null}

      {selected ? (
        <Panel>
          <div className="detail-header">
            <div>
              <p className="eyebrow">Story</p>
              <h2>{selected.displayName}</h2>
            </div>
            <Button className="button-secondary" type="button" onClick={() => setSelected(null)}>Close story</Button>
          </div>
          {selected.publishedAt ? <p className="muted">Published {formatDate(selected.publishedAt)}</p> : null}
          {selected.photo ? (
            <StoryPhoto photo={selected.photo} alt={`Photo shared by ${selected.displayName}`} />
          ) : null}
          <p className="story-body">{selected.story}</p>
          <p className="field-hint">Shared with the patient's consent. Names may be changed to protect privacy.</p>
        </Panel>
      ) : null}

      <Panel>
        <h2>Published stories</h2>
        {loading ? (
          <LoadingState label="Loading stories..." />
        ) : stories.length === 0 ? (
          <p className="empty-state">No published stories are available yet. Please check back soon.</p>
        ) : (
          <div className="stack-list">
            {stories.map((story) => (
              <button className="list-row list-row-button" type="button" key={story.storyId} onClick={() => openStory(story.storyId)}>
                <div>
                  <strong>{story.displayName}</strong>
                  <span className="muted">{excerpt(story.story)}{story.publishedAt ? ` • ${formatDate(story.publishedAt)}` : ""}</span>
                </div>
                <span className="status">Read</span>
              </button>
            ))}
          </div>
        )}
        <div className="button-row">
          <Button className="button-secondary" type="button" disabled={loading || pagination.page <= 1} onClick={() => changePage(-1)}>Previous</Button>
          <span className="field-hint">Page {pagination.page} of {Math.max(pagination.totalPages, 1)} • {pagination.total} story(ies)</span>
          <Button className="button-secondary" type="button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => changePage(1)}>Next</Button>
        </div>
      </Panel>
    </main>
  );
}

function StoryPhoto({ photo, alt }: { photo: PublishedStory["photo"]; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (!photo || failed || !photo.access?.reference) {
    return null;
  }

  return (
    <figure className="story-photo">
      <img src={photo.access.reference} alt={alt} onError={() => setFailed(true)} />
      <figcaption>{photo.documentName}</figcaption>
    </figure>
  );
}

function excerpt(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The patient stories request could not be completed.";
}
