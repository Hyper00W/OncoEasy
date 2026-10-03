import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PatientPageShell } from "../shell/PatientPageShell";
import { Alert, BackLink, Button, EmptyState, LoadingState, PageHero, Panel } from "../components/ui";
import { UsersIcon } from "../components/icons";
import {
  getPublishedStory,
  listPublishedStories,
  type PublishedStory
} from "../stories/stories-api";

type Navigate = (path: string) => void;

/* One story per page: the reader shows a single full-width card and
   Previous/Next step through the feed one story at a time. */
const pageSize = 1;

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
  void leave;

  const detailRequestToken = useRef(0);

  function openStory(storyId: string): void {
    const requestToken = ++detailRequestToken.current;
    setDetailLoading(true);
    setError(null);
    getPublishedStory(storyId)
      .then((story) => {
        if (detailRequestToken.current !== requestToken) return; // a newer story was opened
        setSelected(story);
        window.scrollTo({ top: 0, behavior: "smooth" });
      })
      .catch((requestError: unknown) => {
        if (detailRequestToken.current === requestToken) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (detailRequestToken.current === requestToken) setDetailLoading(false);
      });
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
    <PatientPageShell
      navigate={navigate}
      activePath="/patient/stories"
      className="stories-page"
      backSlot={<BackLink navigate={navigate} fallback="/patient" label="Back to dashboard" />}
    >
      <PageHero
        tone="cream"
        eyebrow="Community &amp; Courage"
        title="Patient stories,"
        highlight="shared with hope."
        description="Read real experiences, recovery journeys, and courage shared by cancer patients and families. Published with consent for community encouragement."
        image="/assets/banner/patient-care.jpg"
        imageAlt="Patient care and support"
        badge={
          <>
            <UsersIcon size={16} /> Community Voices
          </>
        }
        crumbs={[
          { label: "Dashboard", href: "/patient" },
          { label: "Patient stories" }
        ]}
      />

      {error ? (
        <>
          <Alert>{error}</Alert>
          <Button type="button" onClick={retry}>Retry</Button>
        </>
      ) : null}

      {detailLoading ? <LoadingState label="Loading story..." /> : null}

      {selected ? (
        <Panel className="panel-fluid story-detail-panel">
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

      <Panel className="panel-fluid">
        <h2>Published stories</h2>
        {loading ? (
          <LoadingState label="Loading stories..." />
        ) : stories.length === 0 ? (
          <EmptyState
            icon={<UsersIcon size={22} />}
            title="No published stories yet"
            hint="Stories from the community, shared with consent, will appear here."
          />
        ) : (
          <div className="stories-grid stories-grid-single">
            {stories.map((story) => (
              <button className="story-card" type="button" key={story.storyId} onClick={() => openStory(story.storyId)}>
                {story.photo ? (
                  <span className="story-card-media">
                    <StoryThumb photo={story.photo} alt="" />
                  </span>
                ) : (
                  <span className="story-card-media story-card-media-blank" aria-hidden="true">
                    <UsersIcon size={22} />
                  </span>
                )}
                <strong className="story-card-name">{story.displayName}</strong>
                <span className="story-card-excerpt">{excerpt(story.story)}</span>
                {story.publishedAt ? (
                  <span className="story-card-date">Shared {formatDate(story.publishedAt)}</span>
                ) : null}
              </button>
            ))}
          </div>
        )}
        <div className="button-row">
          <Button className="button-secondary" type="button" disabled={loading || pagination.page <= 1} onClick={() => changePage(-1)}>Previous</Button>
          <span className="field-hint">Page {pagination.page} of {Math.max(pagination.totalPages, 1)} • {pagination.total} {pagination.total === 1 ? "story" : "stories"}</span>
          <Button className="button-secondary" type="button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => changePage(1)}>Next</Button>
        </div>
      </Panel>
    </PatientPageShell>
  );
}

function StoryThumb({ photo, alt }: { photo: NonNullable<PublishedStory["photo"]>; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (!photo.access?.reference || failed) {
    return (
      <span className="story-card-thumb-fallback" aria-hidden="true">
        <UsersIcon size={20} />
      </span>
    );
  }

  return (
    <img
      src={photo.access.reference}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function StoryPhoto({ photo, alt }: { photo: PublishedStory["photo"]; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (!photo || failed || !photo.access?.reference) {
    return null;
  }

  return (
    <figure className="story-photo">
      <img src={photo.access.reference} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />
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
