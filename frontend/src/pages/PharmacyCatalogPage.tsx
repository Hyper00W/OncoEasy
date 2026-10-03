import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { MedicineSearch } from "../components/MedicineSearch";
import { ProductCard } from "../components/ProductCard";
import { CategoryRail } from "../components/CategoryRail";
import { Reveal } from "../motion/motion";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import {
  Container,
  EmptyState,
  ErrorState,
  PageHero
} from "../components/ui";
import { DocumentIcon, PillIcon, ShieldHeartIcon, UploadIcon } from "../components/icons";
import {
  listCategories,
  listProducts,
  type Category,
  type Product
} from "../pharmacy/pharmacy-api";
import {
  STOREFRONT_PATH,
  activeFilterCount,
  parseCatalogFilters,
  storefrontPath,
  type CatalogFilters
} from "../pharmacy/pharmacy-catalog";
import { SiteLink } from "../routing/SiteLink";
import { useAuth } from "../auth/AuthContext";

type Navigate = (path: string) => void;

const PAGE_SIZE = 12;

const CATEGORY_IMAGES: Record<string, string> = {
  "oncology-medicines": "/assets/categories/oncology-medicines.jpg",
  "supportive-care": "/assets/categories/supportive-care.jpg",
  "pain-symptom-care": "/assets/categories/pain-care.jpg",
  "nutrition-wellness": "/assets/categories/nutrition-wellness.jpg",
  "medical-devices": "/assets/categories/medical-devices.jpg"
};

/**
 * Public medicine catalog storefront (Phase 6.2). The URL query string is the
 * single source of truth for the active search/filters/page: every control is
 * a link to the next URL, so results are shareable, back/forward works, and a
 * reload reproduces the same view. Only parameters the backend supports
 * (search, category, prescriptionRequired, coldChainRequired, page) are used.
 */
export function PharmacyCatalogPage({ navigate }: { navigate: Navigate }) {
  const filters = parseCatalogFilters(window.location.search);
  const { isAuthenticated, user } = useAuth();
  const isPatient = isAuthenticated && user?.role === "PATIENT";

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  // Initial mount starts in the loading state so the first fetch needs no
  // synchronous setState inside its effect (react-hooks/set-state-in-effect).
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const requestTokenRef = useRef(0);
  const topAnchorRef = useRef<HTMLDivElement | null>(null);

  // Categories load once per mount; failure leaves the rail hidden but the
  // catalog grid still works.
  useEffect(() => {
    let cancelled = false;
    listCategories()
      .then((items) => {
        if (!cancelled) setCategories(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Products load on every URL-driven filter/page change (plus manual retry).
  const { search, category, prescriptionRequired, coldChainRequired, page } = filters;
  const lastQueryRef = useRef("");
  const queryKey = `${search}|${category}|${prescriptionRequired ?? ""}|${coldChainRequired ?? ""}|${page}|${retryToken}`;
  useEffect(() => {
    // The queryKey capture is read on dep change; a same-key re-run (strict
    // mode double-invoke) would duplicate the request, so guard on identity.
    if (lastQueryRef.current === queryKey) return;
    lastQueryRef.current = queryKey;

    const requestToken = ++requestTokenRef.current;

    listProducts({
      search: search || undefined,
      category: category || undefined,
      prescriptionRequired,
      coldChainRequired,
      page,
      pageSize: PAGE_SIZE
    })
      .then((response) => {
        if (requestTokenRef.current !== requestToken) return;
        setProducts(response.items);
        setPagination({
          page,
          total: response.pagination.total,
          totalPages: response.pagination.totalPages
        });
        setIsLoading(false);
      })
      .catch((requestError: unknown) => {
        if (requestTokenRef.current !== requestToken) return;
        setError(requestError instanceof ApiError ? requestError.message : "The catalog is unavailable right now.");
        setIsLoading(false);
      });
  }, [search, category, prescriptionRequired, coldChainRequired, page, retryToken, queryKey]);

  // Scroll to the top of the results when the page number changes.
  const prevPageRef = useRef(page);
  useEffect(() => {
    if (prevPageRef.current !== page) {
      prevPageRef.current = page;
      topAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [page]);

  function applyFilters(next: Partial<CatalogFilters>): void {
    navigate(storefrontPath(filters, next));
  }

  function clearFilters(): void {
    navigate(STOREFRONT_PATH);
  }

  const hasActiveFilters = activeFilterCount(filters) > 0;

  return (
    <div className="site-page">
      <SiteHeader
        navigate={navigate}
        activePath="/pharmacy"
      />

      <main className="site-main">
        <div ref={topAnchorRef} />

        <Container className="storefront-head">
          <PageHero
            tone="teal"
            eyebrow="Certified Oncology Pharmacy & Therapeutics"
            title="Specialty oncology medicines,"
            highlight="verified & delivered."
            description="Access genuine chemotherapy, cold-chain biologicals, and supportive care therapeutics. Every prescription verified by our oncology pharmacy team before fulfillment."
            image="/assets/pharmacy/specialty-pharmacy.webp"
            imageAlt="The OncoEasy specialty pharmacy"
            badge={
              <>
                <ShieldHeartIcon size={16} /> 100% Genuine &amp; Cold-Chain Verified
              </>
            }
            crumbs={[
              { label: "Home", href: "/" },
              { label: "Pharmacy", href: STOREFRONT_PATH },
              ...(filters.category
                ? [{ label: categories.find((c) => c.slug === filters.category)?.name ?? filters.category }]
                : [])
            ]}
            action={
              <a
                className="button"
                href="/patient/pharmacy?tab=prescriptions"
                onClick={(event) => {
                  event.preventDefault();
                  navigate("/patient/pharmacy?tab=prescriptions");
                }}
              >
                <UploadIcon size={16} /> Upload Prescription
              </a>
            }
            secondaryAction={
              !isPatient ? (
                <a
                  className="button button-secondary"
                  href="/"
                  onClick={(event) => {
                    event.preventDefault();
                    navigate("/");
                  }}
                >
                  Sign in as patient
                </a>
              ) : (
                <a
                  className="button button-secondary"
                  href="/patient/pharmacy?tab=cart"
                  onClick={(event) => {
                    event.preventDefault();
                    navigate("/patient/pharmacy?tab=cart");
                  }}
                >
                  View your cart
                </a>
              )
            }
          />

          {categories.length > 0 ? (
            <div className="catalog-category-grid" aria-label="Browse by category">
              <a
                className={`catalog-category-card${!filters.category ? " is-active" : ""}`}
                href={storefrontPath(filters, { category: undefined, page: 1 })}
                onClick={(event) => {
                  event.preventDefault();
                  applyFilters({ category: undefined, page: 1 });
                }}
              >
                <span className="catalog-category-img catalog-category-img-fallback" aria-hidden="true">
                  <PillIcon size={32} />
                </span>
                <span className="catalog-category-name">All Medicines</span>
              </a>
              {categories.map((cat) => {
                const image = CATEGORY_IMAGES[cat.slug];
                const isActive = filters.category === cat.slug;
                return (
                  <a
                    key={cat.id}
                    className={`catalog-category-card${isActive ? " is-active" : ""}`}
                    href={storefrontPath(filters, { category: cat.slug, page: 1 })}
                    onClick={(event) => {
                      event.preventDefault();
                      applyFilters({ category: cat.slug, page: 1 });
                    }}
                  >
                    <span className="catalog-category-img">
                      {image ? (
                        <img src={image} alt="" width={160} height={90} loading="lazy" decoding="async" />
                      ) : (
                        <span className="catalog-category-img-fallback">
                          <PillIcon size={26} />
                        </span>
                      )}
                    </span>
                    <span className="catalog-category-name">{cat.name}</span>
                  </a>
                );
              })}
            </div>
          ) : null}
        </Container>

        <Container className="storefront-body">
          <aside className="storefront-filters" aria-label="Catalog filters">
            <div className="filter-panel">
              <p className="filter-panel-title">Search</p>
              <MedicineSearch
                idPrefix="catalog-search"
                initialQuery={filters.search}
                placeholder="Search name or SKU"
                onSubmit={(query) => applyFilters({ search: query, page: 1 })}
              />
            </div>

            <div className="filter-panel">
              <p className="filter-panel-title">Requirements</p>
              <SiteLink
                className={`filter-option${filters.prescriptionRequired === true ? " is-active" : ""}`}
                href={storefrontPath(filters, {
                  prescriptionRequired: filters.prescriptionRequired === true ? undefined : true,
                  page: 1
                })}
              >
                <span className="filter-option-label">Prescription required</span>
                <span className="filter-option-state">
                  {filters.prescriptionRequired === true ? "On" : "Off"}
                </span>
              </SiteLink>
              <SiteLink
                className={`filter-option${filters.coldChainRequired === true ? " is-active" : ""}`}
                href={storefrontPath(filters, {
                  coldChainRequired: filters.coldChainRequired === true ? undefined : true,
                  page: 1
                })}
              >
                <span className="filter-option-label">Cold-chain (2–8°C)</span>
                <span className="filter-option-state">
                  {filters.coldChainRequired === true ? "On" : "Off"}
                </span>
              </SiteLink>
            </div>

            {hasActiveFilters ? (
              <div className="filter-panel">
                <button className="link-button" type="button" onClick={clearFilters}>
                  Clear all filters
                </button>
                <p className="field-hint">
                  {hasActiveFilters} filter{hasActiveFilters === true ? "" : "s"} active
                </p>
              </div>
            ) : null}

            <div className="filter-panel filter-panel-note">
              <p className="filter-panel-title">Can't find a medicine?</p>
              <p className="field-hint">
                Tell us what you need and our pharmacist team will source it and follow up.
              </p>
              <a
                className="button button-secondary request-medicine-button"
                href="/patient/chat"
                onClick={(event) => {
                  event.preventDefault();
                  navigate("/patient/chat");
                }}
              >
                <DocumentIcon size={16} /> Request a medicine
              </a>
            </div>
          </aside>

          <section className="storefront-results" aria-label="Catalog results">
            <CategoryRail
              categories={categories}
              activeSlug={filters.category}
              currentFilters={{
                search: filters.search,
                prescriptionRequired: filters.prescriptionRequired,
                coldChainRequired: filters.coldChainRequired
              }}
            />

            <div className="results-meta">
              <p className="results-count" role="status">
                {isLoading
                  ? "Loading medicines..."
                  : pagination.total === 0
                    ? "No medicines found"
                    : `Showing ${formatRange(pagination.page, PAGE_SIZE, pagination.total)} of ${pagination.total} medicines`}
              </p>
              {hasActiveFilters ? (
                <button className="link-button results-clear" type="button" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : null}
            </div>

            {isLoading ? (
              <div className="product-grid">
                {Array.from({ length: 6 }, (_, index) => (
                  <div className="product-skeleton" key={index} aria-hidden="true">
                    <div className="product-skeleton-media" />
                    <div className="product-skeleton-line product-skeleton-line-lg" />
                    <div className="product-skeleton-line" />
                    <div className="product-skeleton-line product-skeleton-line-short" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <ErrorState
                message={error}
                onRetry={() => setRetryToken((current) => current + 1)}
                retryLabel="Retry"
              />
            ) : products.length === 0 ? (
              <EmptyState
                title={
                  filters.search
                    ? `No medicines match “${filters.search}”.`
                    : "No medicines match these filters yet."
                }
                hint="Try a different spelling, remove a filter, or request the medicine from our team."
              />
            ) : (
              <>
                <div className="product-grid">
                  {products.map((product, index) => (
                    <Reveal key={product.id} as="div" delay={Math.min(index, 7) * 45} className="reveal-fade">
                      <ProductCard product={product} layout="grid" />
                    </Reveal>
                  ))}
                </div>

                <CatalogPagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  filters={filters}
                  onNavigate={navigate}
                />
              </>
            )}
          </section>
        </Container>
      </main>

      <SiteFooter navigate={navigate} searchQuery={filters.search} />
    </div>
  );
}

function CatalogPagination({
  page,
  totalPages,
  filters,
  onNavigate
}: {
  page: number;
  totalPages: number;
  filters: CatalogFilters;
  onNavigate: (path: string) => void;
}) {
  if (totalPages <= 1) return null;

  const pages = paginationPages(page, totalPages);

  return (
    <nav className="pagination" aria-label="Catalog pages">
      <a
        href={storefrontPath(filters, { page: Math.max(1, page - 1) })}
        className={`pagination-step${page <= 1 ? " is-disabled" : ""}`}
        aria-disabled={page <= 1}
        aria-label="Previous page"
        onClick={(event) => {
          if (page <= 1) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          onNavigate(storefrontPath(filters, { page: page - 1 }));
        }}
      >
        ← Prev
      </a>

      {pages.map((entry, index) =>
        entry === "gap" ? (
          <span className="pagination-gap" key={`gap-${index}`} aria-hidden="true">
            …
          </span>
        ) : (
          <a
            key={entry}
            href={storefrontPath(filters, { page: entry })}
            className={`pagination-page${entry === page ? " is-current" : ""}`}
            aria-current={entry === page ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(storefrontPath(filters, { page: entry }));
            }}
          >
            {entry}
          </a>
        )
      )}

      <a
        href={storefrontPath(filters, { page: Math.min(totalPages, page + 1) })}
        className={`pagination-step${page >= totalPages ? " is-disabled" : ""}`}
        aria-disabled={page >= totalPages}
        aria-label="Next page"
        onClick={(event) => {
          if (page >= totalPages) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          onNavigate(storefrontPath(filters, { page: page + 1 }));
        }}
      >
        Next →
      </a>
    </nav>
  );
}

/** Windowed page list with ellipsis gaps (compact rendering handled in CSS). */
function paginationPages(page: number, totalPages: number): Array<number | "gap"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages: Array<number | "gap"> = [1];
  const windowStart = Math.max(2, page - 1);
  const windowEnd = Math.min(totalPages - 1, page + 1);

  if (windowStart > 2) pages.push("gap");
  for (let p = windowStart; p <= windowEnd; p += 1) pages.push(p);
  if (windowEnd < totalPages - 1) pages.push("gap");
  pages.push(totalPages);
  return pages;
}

function formatRange(page: number, pageSize: number, total: number): string {
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return `${start}–${end}`;
}
