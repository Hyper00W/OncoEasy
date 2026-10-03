import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AdminPortalShell } from "../admin/AdminPortalShell";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";
import {
  createStory,
  listAdminStories,
  setStoryPublished,
  storyStatuses,
  updateStory,
  updateStoryStatus,
  uploadStoryPhoto,
  type AdminStory,
  type StoryStatus
} from "../stories/stories-api";

type Navigate = (path: string) => void;
type PublishedFilter = "ALL" | "PUBLISHED" | "UNPUBLISHED";

type AdminStoriesQuery = {
  page: number;
  status: StoryStatus | "";
  published: PublishedFilter;
};

const pageSize = 10;

const emptyForm = {
  displayName: "",
  story: "",
  consentGiven: false,
  consentTextVersion: ""
};

export function AdminStoriesPage({ navigate }: { navigate: Navigate }) {
  const { user } = useAuth();
  const [stories, setStories] = useState<AdminStory[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize, total: 0, totalPages: 1 });
  const [selected, setSelected] = useState<AdminStory | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [statusFilter, setStatusFilter] = useState<StoryStatus | "">("");
  const [publishedFilter, setPublishedFilter] = useState<PublishedFilter>("ALL");
  const [query, setQuery] = useState<AdminStoriesQuery>({ page: 1, status: "", published: "ALL" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;

    listAdminStories({
      page: query.page,
      pageSize,
      status: query.status || undefined,
      isPublished: query.published === "ALL" ? undefined : query.published === "PUBLISHED"
    })
      .then((response) => {
        if (stale) return; // a newer query superseded this response
        setStories(response.items);
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

  function runQuery(next: AdminStoriesQuery): void {
    setError(null);
    setLoading(true);
    setQuery(next);
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    runQuery({ page: 1, status: statusFilter, published: publishedFilter });
  }

  function resetForm(): void {
    setForm(emptyForm);
    setPhotoFile(null);
    setError(null);
  }

  function startCreate(): void {
    setCreating(true);
    setSelected(null);
    resetForm();
    setNotice(null);
  }

  function openStory(story: AdminStory): void {
    setCreating(false);
    setSelected(story);
    setForm({
      displayName: story.displayName,
      story: story.story,
      consentGiven: story.consentGiven,
      consentTextVersion: story.consentTextVersion ?? ""
    });
    setPhotoFile(null);
    setError(null);
  }

  function refresh(): void {
    runQuery({ ...query });
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!form.displayName.trim() || !form.story.trim()) {
      setError("Display name and story are required.");
      return;
    }
    if (form.consentGiven && !form.consentTextVersion.trim()) {
      setError("A consent text version is required when consent is recorded.");
      return;
    }

    setSaving(true);
    setError(null);
    const payload = {
      displayName: form.displayName.trim(),
      story: form.story.trim(),
      ...(form.consentGiven ? { consentGiven: true, consentTextVersion: form.consentTextVersion.trim() } : { consentGiven: false })
    };
    const request = creating || !selected
      ? createStory({ ...payload, status: "DRAFT", isPublished: false })
      : updateStory(selected.storyId, payload);

    request
      .then((story) => {
        const wasCreating = creating;
        openStory(story);
        setNotice(wasCreating ? `Story created: ${story.displayName}.` : `Story saved: ${story.displayName}.`);
        refresh();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSaving(false));
  }

  function transitionStatus(story: AdminStory, status: StoryStatus): void {
    setSaving(true);
    setError(null);
    updateStoryStatus(story.storyId, status)
      .then((updated) => {
        openStory(updated);
        setNotice(`Status updated to ${formatStatus(updated.status)}.`);
        refresh();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSaving(false));
  }

  function togglePublished(): void {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setStoryPublished(selected.storyId, !selected.isPublished)
      .then((updated) => {
        openStory(updated);
        setNotice(`Story ${updated.isPublished ? "published" : "unpublished"}: ${updated.displayName}.`);
        refresh();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSaving(false));
  }

  function uploadPhoto(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!selected || !photoFile) return;
    setSaving(true);
    setError(null);
    uploadStoryPhoto(selected.storyId, photoFile)
      .then((updated) => {
        openStory(updated);
        setNotice(`Photo uploaded for ${updated.displayName}.`);
        setPhotoFile(null);
        refresh();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSaving(false));
  }

  function nextStatuses(story: AdminStory): StoryStatus[] {
    const allowed: Record<StoryStatus, StoryStatus[]> = {
      DRAFT: ["UNDER_REVIEW"],
      UNDER_REVIEW: ["APPROVED", "REJECTED", "DRAFT"],
      APPROVED: ["REJECTED"],
      REJECTED: ["DRAFT", "UNDER_REVIEW"]
    };
    return allowed[story.status] ?? [];
  }

  if (!user) return null;

  return (
    <AdminPortalShell
      navigate={navigate}
      activePath="/admin/stories"
      title="Patient stories"
      actions={<Button type="button" onClick={startCreate}>New story</Button>}
    >
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}

      <section className="consultation-grid">
        <Panel>
          <div className="detail-header">
            <h2>Stories</h2>
          </div>
          <form className="form-stack" onSubmit={applyFilters}>
            <Field label="Review status" htmlFor="stories-admin-status">
              <select className="input" id="stories-admin-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StoryStatus | "")}>
                <option value="">All statuses</option>
                {storyStatuses.map((value) => <option key={value} value={value}>{formatStatus(value)}</option>)}
              </select>
            </Field>
            <Field label="Publication" htmlFor="stories-admin-published">
              <select className="input" id="stories-admin-published" value={publishedFilter} onChange={(event) => setPublishedFilter(event.target.value as PublishedFilter)}>
                <option value="ALL">All stories</option>
                <option value="PUBLISHED">Published only</option>
                <option value="UNPUBLISHED">Unpublished only</option>
              </select>
            </Field>
            <Button type="submit">Apply filters</Button>
          </form>

          {loading ? (
            <LoadingState label="Loading stories..." />
          ) : stories.length === 0 ? (
            <p className="empty-state">No stories match the current filters.</p>
          ) : (
            <div className="stack-list">
              {stories.map((story) => (
                <button className="list-row list-row-button" type="button" key={story.storyId} onClick={() => openStory(story)}>
                  <div>
                    <strong>{story.displayName}</strong>
                    <span className="muted">{formatStatus(story.status)}{story.consentGiven ? " • Consent recorded" : " • No consent"}{story.updatedBy ? ` • Updated by ${story.updatedBy.fullName}` : ""}</span>
                  </div>
                  <span className="status">{story.isPublished ? "Published" : "Unpublished"}</span>
                </button>
              ))}
            </div>
          )}

          <div className="button-row">
            <Button className="button-secondary" type="button" disabled={loading || pagination.page <= 1} onClick={() => runQuery({ ...query, page: pagination.page - 1 })}>Previous</Button>
            <span className="field-hint">Page {pagination.page} of {Math.max(pagination.totalPages, 1)} • {pagination.total} {pagination.total === 1 ? "story" : "stories"}</span>
            <Button className="button-secondary" type="button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => runQuery({ ...query, page: pagination.page + 1 })}>Next</Button>
          </div>
        </Panel>

        {creating || selected ? (
          <Panel>
            <h2>{creating ? "New story" : "Edit story"}</h2>
            {selected ? (
              <div className="stack-list">
                <p className="muted">
                  {formatStatus(selected.status)} • {selected.isPublished ? "Published" : "Unpublished"}
                  {selected.createdBy ? ` • Created by ${selected.createdBy.fullName}` : ""}
                  {selected.updatedBy ? ` • Updated by ${selected.updatedBy.fullName}` : ""}
                </p>
                <p className="list-row"><strong>Consent</strong><span>{selected.consentGiven ? `Recorded (version ${selected.consentTextVersion ?? "unspecified"})` : "Not recorded"}</span></p>
                {selected.photo ? <p className="list-row"><strong>Photo</strong><span>{selected.photo.documentName}</span></p> : <p className="list-row"><strong>Photo</strong><span>None uploaded</span></p>}
                {selected.publishedAt ? <p className="list-row"><strong>Published at</strong><span>{formatDate(selected.publishedAt)}</span></p> : null}
                <p className="list-row"><strong>Created</strong><span>{formatDate(selected.createdAt)}</span></p>
                <p className="list-row"><strong>Updated</strong><span>{formatDate(selected.updatedAt)}</span></p>
              </div>
            ) : null}
            <form className="form-stack" onSubmit={save}>
              <Field label="Display name" htmlFor="story-display-name">
                <Input id="story-display-name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="e.g. Story from R." />
              </Field>
              <Field label="Story" htmlFor="story-body" hint="Use only content the patient has shared and approved. Do not add medical claims.">
                <textarea className="input textarea" id="story-body" value={form.story} onChange={(event) => setForm({ ...form, story: event.target.value })} />
              </Field>
              <Field label="Consent" htmlFor="story-consent" hint="Publication requires recorded consent; the backend enforces this.">
                <select className="input" id="story-consent" value={form.consentGiven ? "true" : "false"} onChange={(event) => setForm({ ...form, consentGiven: event.target.value === "true" })}>
                  <option value="false">Not recorded</option>
                  <option value="true">Consent given</option>
                </select>
              </Field>
              <Field label="Consent text version" htmlFor="story-consent-version">
                <Input id="story-consent-version" value={form.consentTextVersion} onChange={(event) => setForm({ ...form, consentTextVersion: event.target.value })} placeholder="e.g. consent-v1" />
              </Field>
              <div className="button-row">
                <Button type="submit" disabled={saving}>{saving ? "Saving..." : creating ? "Create story" : "Save changes"}</Button>
                <Button className="button-secondary" type="button" onClick={() => { setCreating(false); setSelected(null); resetForm(); }}>Cancel</Button>
              </div>
            </form>

            {selected ? (
              <>
                <div className="button-row">
                  {nextStatuses(selected).map((status) => (
                    <Button key={status} type="button" disabled={saving} onClick={() => transitionStatus(selected, status)}>
                      Move to {formatStatus(status)}
                    </Button>
                  ))}
                  <Button className="button-secondary" type="button" disabled={saving} onClick={togglePublished}>
                    {selected.isPublished ? "Unpublish" : "Publish"}
                  </Button>
                </div>
                <form className="form-stack" onSubmit={uploadPhoto}>
                  <Field label="Story photo (optional)" htmlFor="story-photo" hint="JPEG, PNG, or WEBP. Stored privately; patients receive a temporary access reference only.">
                    <Input id="story-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} />
                  </Field>
                  <Button type="submit" disabled={saving || !photoFile}>Upload photo</Button>
                </form>
              </>
            ) : null}
          </Panel>
        ) : null}
      </section>
    </AdminPortalShell>
  );
}

function formatStatus(value: string): string {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The patient stories request could not be completed.";
}
