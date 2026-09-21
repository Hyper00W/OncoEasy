import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";
import {
  getPublishedArticle,
  knowledgeCategories,
  listPublishedArticles,
  type KnowledgeArticle,
  type KnowledgeArticleSummary,
  type KnowledgeCategory
} from "../knowledge/knowledge-api";

type Navigate = (path: string) => void;

type KnowledgeQuery = {
  page: number;
  category: KnowledgeCategory | "";
  search: string;
};

const pageSize = 10;

export function PatientKnowledgePage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [articles, setArticles] = useState<KnowledgeArticleSummary[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize, total: 0, totalPages: 1 });
  const [article, setArticle] = useState<KnowledgeArticle | null>(null);
  const [query, setQuery] = useState<KnowledgeQuery>({ page: 1, category: "", search: "" });
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPublishedArticles({
      page: query.page,
      pageSize,
      category: query.category || undefined,
      search: query.search || undefined
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

  function runQuery(next: KnowledgeQuery): void {
    setArticle(null);
    setError(null);
    setLoading(true);
    setQuery(next);
  }

  function applySearch(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    runQuery({ page: 1, category: query.category, search: searchInput.trim() });
  }

  function clearFilters(): void {
    setSearchInput("");
    runQuery({ page: 1, category: "", search: "" });
  }

  function openArticle(slug: string): void {
    setDetailLoading(true);
    setError(null);
    getPublishedArticle(slug)
      .then(setArticle)
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setDetailLoading(false));
  }

  if (!user) return null;

  return (
    <main className="workspace-page consultation-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Patient education</p>
          <h1>Knowledge bank</h1>
          <p className="intro">Browse published articles about diagnosis, treatment, research, and general care.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={leave}>Sign out</Button>
      </header>

      {error ? <Alert>{error}</Alert> : null}

      <section className="consultation-grid">
        <Panel>
          <h2>Search and filter</h2>
          <form className="form-stack" onSubmit={applySearch}>
            <Field label="Search articles" htmlFor="knowledge-search">
              <Input id="knowledge-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search titles and content" />
            </Field>
            <Field label="Category" htmlFor="knowledge-category">
              <select className="input" id="knowledge-category" value={query.category} onChange={(event) => runQuery({ page: 1, category: event.target.value as KnowledgeCategory | "", search: query.search })}>
                <option value="">All categories</option>
                {knowledgeCategories.map((value) => <option key={value} value={value}>{formatCategory(value)}</option>)}
              </select>
            </Field>
            <div className="button-row">
              <Button type="submit">Search</Button>
              <Button className="button-secondary" type="button" onClick={clearFilters}>Clear</Button>
            </div>
          </form>
        </Panel>

        <Panel>
          <h2>Published articles</h2>
          {loading ? (
            <LoadingState label="Loading articles..." />
          ) : articles.length === 0 ? (
            <p className="empty-state">No published articles match your search.</p>
          ) : (
            <div className="stack-list">
              {articles.map((item) => (
                <button className="list-row list-row-button" type="button" key={item.articleId} onClick={() => openArticle(item.slug)}>
                  <div>
                    <strong>{item.title}</strong>
                    <span className="muted">{formatCategory(item.category)} • {item.publishedAt ? formatDate(item.publishedAt) : "Published"}</span>
                    <span className="muted">{item.summary}</span>
                  </div>
                  <span className="status">Read</span>
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

        {detailLoading ? <LoadingState label="Loading article..." /> : null}

        {article ? (
          <Panel>
            <div className="detail-header">
              <div>
                <p className="eyebrow">{formatCategory(article.category)}</p>
                <h2>{article.title}</h2>
              </div>
              <span className="status">{article.publishedAt ? formatDate(article.publishedAt) : "Published"}</span>
            </div>
            <p className="muted">{article.summary}</p>
            <p>{article.content}</p>
            <div className="button-row">
              <Button className="button-secondary" type="button" onClick={() => setArticle(null)}>Close article</Button>
            </div>
          </Panel>
        ) : null}
      </section>
    </main>
  );
}

function formatCategory(value: string): string {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The knowledge request could not be completed.";
}
