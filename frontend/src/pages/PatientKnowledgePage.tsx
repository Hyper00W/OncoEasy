import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PatientPageShell } from "../shell/PatientPageShell";
import { Alert, BackLink, Button, EmptyState, Field, Input, LoadingState, PageHero, Panel } from "../components/ui";
import { BookIcon } from "../components/icons";
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

const pageSize = 9;

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
    let stale = false;

    listPublishedArticles({
      page: query.page,
      pageSize,
      category: query.category || undefined,
      search: query.search || undefined
    })
      .then((response) => {
        if (stale) return; // a newer query superseded this response
        setArticles(response.items);
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

  function leave(): void {
    signOut();
    navigate("/");
  }
  void leave;

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

  const detailRequestToken = useRef(0);

  function openArticle(slug: string): void {
    const requestToken = ++detailRequestToken.current;
    setDetailLoading(true);
    setError(null);
    getPublishedArticle(slug)
      .then((article) => {
        if (detailRequestToken.current !== requestToken) return; // a newer article was opened
        setArticle(article);
      })
      .catch((requestError: unknown) => {
        if (detailRequestToken.current === requestToken) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (detailRequestToken.current === requestToken) setDetailLoading(false);
      });
  }

  if (!user) return null;

  const hasFilters = Boolean(query.search || query.category);

  return (
    <PatientPageShell
      navigate={navigate}
      activePath="/patient/knowledge"
      className="knowledge-page"
      backSlot={<BackLink navigate={navigate} fallback="/patient" label="Back to dashboard" />}
    >
      <PageHero
        tone="lavender"
        eyebrow="Clinical Oncology Education"
        title="Knowledge bank &amp; guides,"
        highlight="simplified &amp; clear."
        description="Explore verified clinical guides, treatment explanations, side effect management, and research articles reviewed by our oncology team."
        image="/assets/pharmacy/pharmacy-store.avif"
        imageAlt="Oncology research and literature"
        badge={
          <>
            <BookIcon size={16} /> Clinical Knowledge Library
          </>
        }
        crumbs={[
          { label: "Dashboard", href: "/patient" },
          { label: "Knowledge" }
        ]}
      />

      {error ? <Alert>{error}</Alert> : null}

      <div className="knowledge-tabs-bar" role="tablist" aria-label="Article categories">
        <button
          type="button"
          className={`knowledge-tab-pill${!query.category ? " is-active" : ""}`}
          onClick={() => runQuery({ page: 1, category: "", search: query.search })}
        >
          All topics
        </button>
        {knowledgeCategories.map((value) => (
          <button
            key={value}
            type="button"
            className={`knowledge-tab-pill${query.category === value ? " is-active" : ""}`}
            onClick={() => runQuery({ page: 1, category: query.category === value ? "" : value, search: query.search })}
          >
            {formatCategory(value)}
          </button>
        ))}
      </div>

      <section className="knowledge-layout">
        <Panel className="panel-fluid knowledge-filter">
          <h2>Search library</h2>
          <form className="form-stack" onSubmit={applySearch}>
            <Field label="Search topics and drugs" htmlFor="knowledge-search">
              <Input id="knowledge-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="e.g. Immunotherapy, nausea" />
            </Field>
            <div className="button-row">
              <Button type="submit">Search</Button>
              {hasFilters ? (
                <Button className="button-secondary" type="button" onClick={clearFilters}>Clear</Button>
              ) : null}
            </div>
          </form>
        </Panel>

        <div className="knowledge-main">
          <div className="knowledge-section-head">
            <h2>Published articles</h2>
            <span className="field-hint">{pagination.total} article(s)</span>
          </div>

          {loading ? (
            <LoadingState label="Loading articles..." />
          ) : articles.length === 0 ? (
            <Panel className="panel-fluid">
              <EmptyState
                icon={<BookIcon size={22} />}
                title={hasFilters ? "No articles match your search" : "No articles published yet"}
                hint={hasFilters ? "Try a different search term or category." : "Educational articles will appear here as our care team publishes them."}
              />
            </Panel>
          ) : (
            <div className="article-grid">
              {articles.map((item, index) => (
                <button
                  className={`article-card${index === 0 && !hasFilters ? " article-card-featured" : ""}`}
                  type="button"
                  key={item.articleId}
                  onClick={() => openArticle(item.slug)}
                >
                  {index === 0 && !hasFilters ? <span className="article-featured-flag">Featured</span> : null}
                  <span className="article-card-icon" aria-hidden="true">
                    <BookIcon size={18} />
                  </span>
                  <span className="article-card-category">{formatCategory(item.category)}</span>
                  <strong className="article-card-title">{item.title}</strong>
                  {item.summary ? <span className="article-card-summary">{item.summary}</span> : null}
                  <span className="article-card-date">{item.publishedAt ? formatDate(item.publishedAt) : "Published"}</span>
                </button>
              ))}
            </div>
          )}

          <div className="button-row knowledge-pagination">
            <Button className="button-secondary" type="button" disabled={loading || pagination.page <= 1} onClick={() => runQuery({ ...query, page: pagination.page - 1 })}>Previous</Button>
            <span className="field-hint">Page {pagination.page} of {Math.max(pagination.totalPages, 1)}</span>
            <Button className="button-secondary" type="button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => runQuery({ ...query, page: pagination.page + 1 })}>Next</Button>
          </div>

          {detailLoading ? <LoadingState label="Loading article..." /> : null}

          {article ? (
            <Panel className="panel-fluid article-reader">
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
        </div>
      </section>
    </PatientPageShell>
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
