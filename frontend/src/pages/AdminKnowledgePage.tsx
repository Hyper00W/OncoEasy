import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";
import {
  createArticle,
  knowledgeCategories,
  listAdminArticles,
  setArticlePublished,
  updateArticle,
  type AdminKnowledgeArticle,
  type KnowledgeCategory
} from "../knowledge/knowledge-api";

type Navigate = (path: string) => void;
type PublishedFilter = "ALL" | "PUBLISHED" | "UNPUBLISHED";

type AdminKnowledgeQuery = {
  page: number;
  category: KnowledgeCategory | "";
  search: string;
  published: PublishedFilter;
};

const pageSize = 10;

export function AdminKnowledgePage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [articles, setArticles] = useState<AdminKnowledgeArticle[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize, total: 0, totalPages: 1 });
  const [selected, setSelected] = useState<AdminKnowledgeArticle | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState<KnowledgeCategory>("GENERAL");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<KnowledgeCategory | "">("");
  const [publishedFilter, setPublishedFilter] = useState<PublishedFilter>("ALL");
  const [query, setQuery] = useState<AdminKnowledgeQuery>({ page: 1, category: "", search: "", published: "ALL" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    listAdminArticles({
      page: query.page,
      pageSize,
      category: query.category || undefined,
      search: query.search || undefined,
      isPublished: query.published === "ALL" ? undefined : query.published === "PUBLISHED"
    })
      .then((response) => {
        setArticles(response.items);
        setPagination(response.pagination);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, [query]);

  function leave(): void {
    signOut();
    navigate("/");
  }

  function runQuery(next: AdminKnowledgeQuery): void {
    setError(null);
    setLoading(true);
    setQuery(next);
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    runQuery({ page: 1, category: categoryFilter, search: searchInput.trim(), published: publishedFilter });
  }

  function resetForm(): void {
    setTitle("");
    setSlug("");
    setCategory("GENERAL");
    setSummary("");
    setContent("");
    setIsPublished(false);
    setError(null);
  }

  function startCreate(): void {
    setCreating(true);
    setSelected(null);
    resetForm();
    setNotice(null);
  }

  function openArticle(article: AdminKnowledgeArticle): void {
    setCreating(false);
    setSelected(article);
    setTitle(article.title);
    setSlug(article.slug);
    setCategory(article.category);
    setSummary(article.summary);
    setContent(article.content);
    setIsPublished(article.isPublished);
    setError(null);
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!title.trim() || !slug.trim() || !summary.trim() || !content.trim()) {
      setError("Title, slug, summary, and content are required.");
      return;
    }

    setSaving(true);
    setError(null);
    const request = creating || !selected
      ? createArticle({
        title: title.trim(),
        slug: slug.trim(),
        category,
        summary: summary.trim(),
        content: content.trim(),
        isPublished
      })
      : updateArticle(selected.articleId, {
        title: title.trim(),
        slug: slug.trim(),
        category,
        summary: summary.trim(),
        content: content.trim()
      });

    request
      .then((article) => {
        const wasCreating = creating;
        openArticle(article);
        setNotice(wasCreating ? `Article created: ${article.title}.` : `Article saved: ${article.title}.`);
        runQuery({ ...query });
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSaving(false));
  }

  function togglePublished(): void {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setArticlePublished(selected.articleId, !selected.isPublished)
      .then((article) => {
        openArticle(article);
        setNotice(`Article ${article.isPublished ? "published" : "unpublished"}: ${article.title}.`);
        runQuery({ ...query });
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
          <h1>Knowledge articles</h1>
          <p className="intro">Create and maintain the published patient education articles.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={leave}>Sign out</Button>
      </header>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}

      <section className="consultation-grid">
        <Panel>
          <div className="detail-header">
            <h2>Articles</h2>
            <Button type="button" onClick={startCreate}>New article</Button>
          </div>
          <form className="form-stack" onSubmit={applyFilters}>
            <Field label="Search articles" htmlFor="knowledge-admin-search">
              <Input id="knowledge-admin-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search titles and content" />
            </Field>
            <Field label="Category" htmlFor="knowledge-admin-category">
              <select className="input" id="knowledge-admin-category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as KnowledgeCategory | "")}>
                <option value="">All categories</option>
                {knowledgeCategories.map((value) => <option key={value} value={value}>{formatCategory(value)}</option>)}
              </select>
            </Field>
            <Field label="Publication" htmlFor="knowledge-admin-published">
              <select className="input" id="knowledge-admin-published" value={publishedFilter} onChange={(event) => setPublishedFilter(event.target.value as PublishedFilter)}>
                <option value="ALL">All articles</option>
                <option value="PUBLISHED">Published only</option>
                <option value="UNPUBLISHED">Unpublished only</option>
              </select>
            </Field>
            <Button type="submit">Apply filters</Button>
          </form>

          {loading ? (
            <LoadingState label="Loading articles..." />
          ) : articles.length === 0 ? (
            <p className="empty-state">No articles match the current filters.</p>
          ) : (
            <div className="stack-list">
              {articles.map((article) => (
                <button className="list-row list-row-button" type="button" key={article.articleId} onClick={() => openArticle(article)}>
                  <div>
                    <strong>{article.title}</strong>
                    <span className="muted">{formatCategory(article.category)} • {article.slug}</span>
                  </div>
                  <span className="status">{article.isPublished ? "Published" : "Draft"}</span>
                </button>
              ))}
            </div>
          )}

          <div className="button-row">
            <Button className="button-secondary" type="button" disabled={loading || pagination.page <= 1} onClick={() => runQuery({ ...query, page: pagination.page - 1 })}>Previous</Button>
            <span className="field-hint">Page {pagination.page} of {Math.max(pagination.totalPages, 1)} • {pagination.total} article(s)</span>
            <Button className="button-secondary" type="button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => runQuery({ ...query, page: pagination.page + 1 })}>Next</Button>
          </div>
        </Panel>

        {creating || selected ? (
          <Panel>
            <h2>{creating ? "New article" : "Edit article"}</h2>
            {selected ? (
              <p className="muted">
                {selected.isPublished ? "Published" : "Draft"}
                {selected.updatedBy ? ` • Last updated by ${selected.updatedBy.fullName}` : ""}
              </p>
            ) : null}
            <form className="form-stack" onSubmit={save}>
              <Field label="Title" htmlFor="knowledge-title">
                <Input id="knowledge-title" value={title} onChange={(event) => setTitle(event.target.value)} />
              </Field>
              <Field label="Slug" htmlFor="knowledge-slug" hint="Lowercase letters, numbers, and hyphens.">
                <Input id="knowledge-slug" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="understanding-treatment-options" />
              </Field>
              <Field label="Category" htmlFor="knowledge-edit-category">
                <select className="input" id="knowledge-edit-category" value={category} onChange={(event) => setCategory(event.target.value as KnowledgeCategory)}>
                  {knowledgeCategories.map((value) => <option key={value} value={value}>{formatCategory(value)}</option>)}
                </select>
              </Field>
              <Field label="Summary" htmlFor="knowledge-summary">
                <textarea className="input textarea" id="knowledge-summary" value={summary} onChange={(event) => setSummary(event.target.value)} />
              </Field>
              <Field label="Content" htmlFor="knowledge-content">
                <textarea className="input textarea" id="knowledge-content" value={content} onChange={(event) => setContent(event.target.value)} />
              </Field>
              {creating ? (
                <Field label="Publication" htmlFor="knowledge-published">
                  <select className="input" id="knowledge-published" value={isPublished ? "true" : "false"} onChange={(event) => setIsPublished(event.target.value === "true")}>
                    <option value="false">Save as draft</option>
                    <option value="true">Publish now</option>
                  </select>
                </Field>
              ) : null}
              <div className="button-row">
                <Button type="submit" disabled={saving}>{saving ? "Saving..." : creating ? "Create article" : "Save changes"}</Button>
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
      </section>
    </main>
  );
}

function formatCategory(value: string): string {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The knowledge request could not be completed.";
}
