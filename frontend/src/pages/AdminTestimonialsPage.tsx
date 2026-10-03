import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AdminPortalShell } from "../admin/AdminPortalShell";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";
import {
  createTestimonial,
  deleteTestimonial,
  fetchAdminTestimonialMedia,
  listAdminTestimonials,
  testimonialTypes,
  updateTestimonial,
  uploadTestimonialMedia,
  type AdminTestimonial,
  type TestimonialType
} from "../testimonials/testimonials-api";

type Navigate = (path: string) => void;

type TestimonialsQuery = {
  page: number;
  type: TestimonialType | "";
  published: "ALL" | "PUBLISHED" | "UNPUBLISHED";
};

const pageSize = 20;

const emptyForm = {
  type: "IMAGE" as TestimonialType,
  title: "",
  description: "",
  displayName: "",
  displayOrder: "0"
};

export function AdminTestimonialsPage({ navigate }: { navigate: Navigate }) {
  const { user } = useAuth();
  const [testimonials, setTestimonials] = useState<AdminTestimonial[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize, total: 0, totalPages: 1 });
  const [selected, setSelected] = useState<AdminTestimonial | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [typeFilter, setTypeFilter] = useState<TestimonialType | "">("");
  const [publishedFilter, setPublishedFilter] = useState<TestimonialsQuery["published"]>("ALL");
  const [query, setQuery] = useState<TestimonialsQuery>({ page: 1, type: "", published: "ALL" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    listAdminTestimonials({
      page: query.page,
      pageSize,
      type: query.type || undefined,
      published: query.published === "ALL" ? undefined : query.published === "PUBLISHED"
    })
      .then((response) => {
        if (!cancelled) {
          setTestimonials(response.items);
          setPagination(response.pagination);
        }
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
  }, [query]);

  function runQuery(next: TestimonialsQuery): void {
    setError(null);
    setLoading(true);
    setQuery(next);
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    runQuery({ page: 1, type: typeFilter, published: publishedFilter });
  }

  function resetForm(): void {
    setForm(emptyForm);
    setMediaFile(null);
    setError(null);
  }

  function startCreate(): void {
    setCreating(true);
    setSelected(null);
    resetForm();
    clearPreview();
    setNotice(null);
  }

  function clearPreview(): void {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  }

  function openTestimonial(testimonial: AdminTestimonial): void {
    setCreating(false);
    setSelected(testimonial);
    clearPreview();
    setForm({
      type: testimonial.type,
      title: testimonial.title,
      description: testimonial.description,
      displayName: testimonial.displayName,
      displayOrder: String(testimonial.displayOrder)
    });
    setMediaFile(null);
    setError(null);
  }

  function refresh(): void {
    runQuery({ ...query });
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (saving || uploading) return; // never fire a second in-flight request
    const displayOrder = Number.parseInt(form.displayOrder, 10);
    if (!form.title.trim() || !form.description.trim() || !form.displayName.trim()) {
      setError("Title, description, and display name are required.");
      return;
    }
    if (!Number.isInteger(displayOrder) || displayOrder < 0) {
      setError("Display order must be a whole number of 0 or more.");
      return;
    }

    setSaving(true);
    setError(null);
    const payload = {
      type: form.type,
      title: form.title.trim(),
      description: form.description.trim(),
      displayName: form.displayName.trim(),
      displayOrder
    };
    const request = creating || !selected
      ? createTestimonial({ ...payload, published: false })
      : updateTestimonial(selected.testimonialId, payload);

    request
      .then((testimonial) => {
        const wasCreating = creating;
        openTestimonial(testimonial);
        setNotice(wasCreating ? `Testimonial created: ${testimonial.title}.` : `Testimonial saved: ${testimonial.title}.`);
        refresh();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSaving(false));
  }

  function togglePublished(): void {
    if (!selected || saving || uploading) return;
    setSaving(true);
    setError(null);
    updateTestimonial(selected.testimonialId, { published: !selected.published })
      .then((updated) => {
        openTestimonial(updated);
        setNotice(`Testimonial ${updated.published ? "published" : "unpublished"}: ${updated.title}.`);
        refresh();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSaving(false));
  }

  function uploadMedia(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!selected || !mediaFile || uploading || saving) return;
    setUploading(true);
    setError(null);
    const replacing = selected.media !== null;
    uploadTestimonialMedia(selected.testimonialId, selected.type, mediaFile)
      .then((updated) => {
        openTestimonial(updated);
        setNotice(`${updated.type === "VIDEO" ? "Video" : "Image"} ${replacing ? "replaced" : "uploaded"} for ${updated.title}.`);
        setMediaFile(null);
        refresh();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setUploading(false));
  }

  // The browser cannot attach the bearer token to <img>/<video>, so private media
  // is fetched as a blob and previewed from a temporary object URL.
  function loadPreview(): void {
    if (!selected || !selected.media) return;
    setPreviewing(true);
    setError(null);
    fetchAdminTestimonialMedia(selected.testimonialId)
      .then((blob) => {
        clearPreview();
        const objectUrl = URL.createObjectURL(blob);
        previewUrlRef.current = objectUrl;
        setPreviewUrl(objectUrl);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setPreviewing(false));
  }

  function remove(testimonial: AdminTestimonial): void {
    if (saving || uploading) return;
    if (!window.confirm(`Delete testimonial "${testimonial.title}"? This also removes its media.`)) return;
    setSaving(true);
    setError(null);
    deleteTestimonial(testimonial.testimonialId)
      .then(() => {
        setSelected(null);
        clearPreview();
        setNotice(`Testimonial deleted: ${testimonial.title}.`);
        refresh();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSaving(false));
  }

  if (!user) return null;

  return (
    <AdminPortalShell
      navigate={navigate}
      activePath="/admin/testimonials"
      title="Testimonials"
      actions={<Button type="button" onClick={startCreate}>New testimonial</Button>}
    >
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}

      <section className="consultation-grid">
        <Panel>
          <div className="detail-header">
            <h2>Testimonials</h2>
          </div>
          <form className="form-stack" onSubmit={applyFilters}>
            <Field label="Type" htmlFor="testimonials-admin-type">
              <select className="input" id="testimonials-admin-type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as TestimonialType | "")}>
                <option value="">All types</option>
                {testimonialTypes.map((value) => <option key={value} value={value}>{formatType(value)}</option>)}
              </select>
            </Field>
            <Field label="Publication" htmlFor="testimonials-admin-published">
              <select className="input" id="testimonials-admin-published" value={publishedFilter} onChange={(event) => setPublishedFilter(event.target.value as TestimonialsQuery["published"])}>
                <option value="ALL">All testimonials</option>
                <option value="PUBLISHED">Published only</option>
                <option value="UNPUBLISHED">Unpublished only</option>
              </select>
            </Field>
            <Button type="submit">Apply filters</Button>
          </form>

          {loading ? (
            <LoadingState label="Loading testimonials..." />
          ) : testimonials.length === 0 ? (
            <p className="empty-state">No testimonials match the current filters.</p>
          ) : (
            <div className="stack-list">
              {testimonials.map((testimonial) => (
                <button className="list-row list-row-button" type="button" key={testimonial.testimonialId} onClick={() => openTestimonial(testimonial)}>
                  <div>
                    <strong>{testimonial.title}</strong>
                    <span className="muted">{formatType(testimonial.type)} • Order {testimonial.displayOrder} • {testimonial.displayName}</span>
                  </div>
                  <span className="status">{testimonial.published ? "Published" : "Unpublished"}</span>
                </button>
              ))}
            </div>
          )}

          <div className="button-row">
            <Button className="button-secondary" type="button" disabled={loading || pagination.page <= 1} onClick={() => runQuery({ ...query, page: pagination.page - 1 })}>Previous</Button>
            <span className="field-hint">Page {pagination.page} of {Math.max(pagination.totalPages, 1)} • {pagination.total} testimonial(s)</span>
            <Button className="button-secondary" type="button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => runQuery({ ...query, page: pagination.page + 1 })}>Next</Button>
          </div>
        </Panel>

        {creating || selected ? (
          <Panel>
            <h2>{creating ? "New testimonial" : "Edit testimonial"}</h2>
            {selected ? (
              <div className="stack-list">
                <p className="muted">{formatType(selected.type)} • {selected.published ? "Published" : "Unpublished"}</p>
                <p className="list-row"><strong>Media</strong><span>{selected.media ? `${selected.media.documentName} (${formatType(selected.type)}${selected.media.mimeType ? `, ${selected.media.mimeType}` : ""}, uploaded ${formatDate(selected.media.uploadedAt)})` : "None uploaded — publishing stays disabled until media is added"}</span></p>
                <p className="list-row"><strong>Created</strong><span>{formatDate(selected.createdAt)}</span></p>
                <p className="list-row"><strong>Updated</strong><span>{formatDate(selected.updatedAt)}</span></p>              </div>
            ) : null}
            <form className="form-stack" onSubmit={save} aria-busy={saving}>
              <Field label="Type" htmlFor="testimonial-type" hint={selected ? "Type is fixed once media is uploaded." : "Choose whether this is an image or video testimonial."}>
                <select className="input" id="testimonial-type" value={form.type} disabled={!creating} onChange={(event) => setForm({ ...form, type: event.target.value as TestimonialType })}>
                  {testimonialTypes.map((value) => <option key={value} value={value}>{formatType(value)}</option>)}
                </select>
              </Field>
              <Field label="Title" htmlFor="testimonial-title">
                <Input id="testimonial-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Finding support early" />
              </Field>
              <Field label="Description" htmlFor="testimonial-description" hint="Only include content the person has agreed to share. Do not add medical claims.">
                <textarea className="input textarea" id="testimonial-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              </Field>
              <Field label="Display name" htmlFor="testimonial-name" hint="Shown publicly. Use the name or alias the person approved.">
                <Input id="testimonial-name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="e.g. R. from Pune" />
              </Field>
              <Field label="Display order" htmlFor="testimonial-order" hint="Lower numbers appear first on the public page.">
                <Input id="testimonial-order" type="number" min={0} step={1} value={form.displayOrder} onChange={(event) => setForm({ ...form, displayOrder: event.target.value })} />
              </Field>
              <div className="button-row">
                <Button type="submit" disabled={saving || uploading}>{saving ? "Saving..." : creating ? "Create testimonial" : "Save changes"}</Button>
                <Button className="button-secondary" type="button" onClick={() => { setCreating(false); setSelected(null); resetForm(); }}>Cancel</Button>
              </div>
            </form>

            {selected ? (
              <>
                <form className="form-stack" onSubmit={uploadMedia} aria-busy={uploading}>
                  <Field
                    label={selected.type === "VIDEO" ? "Video file" : "Image file"}
                    htmlFor="testimonial-media"
                    hint={selected.type === "VIDEO" ? "MP4 or WEBM. Stored privately; the public page loads it through the backend delivery path (or a signed URL in production)." : "JPEG, PNG, or WEBP. Stored privately; the public page loads it through the backend delivery path (or a signed URL in production)."}
                  >
                    <Input id="testimonial-media" type="file" accept={selected.type === "VIDEO" ? "video/mp4,video/webm" : "image/jpeg,image/png,image/webp"} onChange={(event) => setMediaFile(event.target.files?.[0] ?? null)} />
                  </Field>
                  <Button type="submit" disabled={saving || uploading || !mediaFile}>{uploading ? "Uploading..." : selected.media ? "Replace media" : "Upload media"}</Button>
                </form>
                {selected.media ? (
                  <div className="testimonial-preview">
                    <div className="detail-header">
                      <h3>Media preview</h3>
                      <Button className="button-secondary" type="button" disabled={previewing} onClick={loadPreview}>
                        {previewing ? "Loading..." : previewUrl ? "Reload preview" : "Load preview"}
                      </Button>
                    </div>
                    {previewUrl ? (
                      selected.type === "VIDEO" ? (
                        <video className="testimonial-media" src={previewUrl} controls playsInline preload="metadata" aria-label={`Media preview video for ${selected.title}`} />
                      ) : (
                        <img className="testimonial-media" src={previewUrl} alt={`Preview of ${selected.title}`} />
                      )
                    ) : (
                      <p className="muted">Private media is previewed through the authenticated API.</p>
                    )}
                  </div>
                ) : null}
                <div className="button-row">
                  <Button
                    className="button-secondary"
                    type="button"
                    disabled={saving || uploading || !selected.media}
                    onClick={togglePublished}
                    aria-pressed={selected.published}
                    title={selected.media ? undefined : "Upload media before publishing."}
                  >
                    {selected.published ? "Unpublish testimonial" : "Publish testimonial"}
                  </Button>
                  <Button
                    className="button-secondary"
                    type="button"
                    disabled={saving || uploading}
                    onClick={() => remove(selected)}
                    aria-label={`Delete testimonial: ${selected.title}`}
                  >
                    Delete testimonial
                  </Button>
                </div>
              </>
            ) : null}
          </Panel>
        ) : null}
      </section>
    </AdminPortalShell>
  );
}

function formatType(value: TestimonialType): string {
  return value === "VIDEO" ? "Video" : "Image";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The testimonials request could not be completed.";
}
