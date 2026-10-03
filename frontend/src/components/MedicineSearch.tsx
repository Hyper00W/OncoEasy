import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { SearchIcon } from "./icons";
import { LoadingState } from "./ui";
import { listProducts, type Product } from "../pharmacy/pharmacy-api";
import { productDetailPath } from "../pharmacy/pharmacy-catalog";
import { SiteLink } from "../routing/SiteLink";

type SearchStatus = "idle" | "loading" | "results" | "empty" | "error";

const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 6;
const MIN_QUERY_LENGTH = 2;

function formatPrice(product: Product): string {
  return `${product.currency} ${product.price}`;
}

/**
 * Public medicine search backed by the unauthenticated catalog endpoint
 * (GET /api/v1/pharmacy/products?search=...). Results are real API data only —
 * nothing is fabricated. Debounced, with a single in-flight request respected
 * via a token so late responses cannot overwrite newer ones.
 *
 * Submissions hand the query to `onSubmit` (pages wire it into the catalog),
 * while result rows link straight to product detail pages. A page may seed
 * the field via `initialQuery` so the header search keeps its value while
 * browsing catalog results.
 */
export function MedicineSearch({
  placeholder = "Search medicines, supplements, and care products",
  onSubmit,
  onResultNavigate,
  initialQuery = "",
  idPrefix = "medicine-search"
}: {
  placeholder?: string;
  /** Called when the user submits the search (Enter or the search button). */
  onSubmit?: (query: string) => void;
  /** Optional hook for result-row navigation (defaults to internal SiteLink). */
  onResultNavigate?: (path: string) => void;
  /** Seeds the field (used by the catalog page to persist the query). */
  initialQuery?: string;
  idPrefix?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Product[]>([]);
  const [resolvedStatus, setResolvedStatus] = useState<"results" | "empty" | "error">("empty");
  const [resolvedQuery, setResolvedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [errorMessage, setErrorMessage] = useState("Search is unavailable right now.");
  const requestTokenRef = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = `${idPrefix}-results`;

  // Query state is derived, not stored: while a non-empty query differs from
  // the last resolved query, the search is either debouncing or in flight.
  const trimmedQuery = query.trim();
  const isIdle = trimmedQuery.length < MIN_QUERY_LENGTH;
  const isPending = !isIdle && trimmedQuery !== resolvedQuery;
  const effectiveStatus: SearchStatus = isIdle
    ? "idle"
    : isPending
      ? "loading"
      : resolvedStatus;

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
      // Invalidate any in-flight request; stale results stay hidden because
      // the effective status is idle.
      requestTokenRef.current += 1;
      return;
    }

    const requestToken = ++requestTokenRef.current;
    const timer = window.setTimeout(() => {
      if (requestTokenRef.current !== requestToken) return;
      listProducts({ search: trimmed, page: 1, pageSize: RESULT_LIMIT })
        .then((response) => {
          if (requestTokenRef.current !== requestToken) return;
          setResults(response.items);
          setResolvedQuery(trimmed);
          setResolvedStatus(response.items.length > 0 ? "results" : "empty");
          setActiveIndex(-1);
        })
        .catch((error: unknown) => {
          if (requestTokenRef.current !== requestToken) return;
          setResults([]);
          setResolvedQuery(trimmed);
          setResolvedStatus("error");
          setErrorMessage(error instanceof ApiError ? error.message : "Search is unavailable right now.");
        });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query]);

  // Dismiss the popover on outside click.
  useEffect(() => {
    function handlePointerDown(event: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  // Re-seed the field when the page provides a new query (e.g. navigating
  // between catalog states); only applies while the user is not editing.
  const prevInitialRef = useRef(initialQuery);
  useEffect(() => {
    if (initialQuery !== prevInitialRef.current) {
      prevInitialRef.current = initialQuery;
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setIsOpen(false);
    onSubmit?.(query.trim());
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      setIsOpen(false);
      return;
    }

    if (!isOpen || effectiveStatus !== "results" || results.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? results.length - 1 : current - 1));
    }
  }

  const showPopover =
    isOpen &&
    !isIdle &&
    (effectiveStatus === "loading" || effectiveStatus === "results" || effectiveStatus === "empty" || effectiveStatus === "error");

  return (
    <div className="search-box" ref={rootRef}>
      <form className="search-field" role="search" onSubmit={handleSubmit}>
        <span className="search-field-icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          className="search-input"
          type="search"
          role="combobox"
          aria-expanded={showPopover}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Search medicines and products"
          placeholder={placeholder}
          value={query}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            // Open in response to the user's input; closing happens via
            // Escape, outside click, or submit.
            setIsOpen(true);
          }}
          onFocus={() => {
            // Re-open with previously resolved results when the field is
            // refocused without retyping.
            if (!isIdle && trimmedQuery === resolvedQuery) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        <button className="search-submit" type="submit">
          Search
        </button>
      </form>

      {showPopover ? (
        <div className="search-popover" id={listId} role="listbox" aria-label="Search suggestions">
          {effectiveStatus === "loading" ? (
            <p className="search-status">
              <LoadingState label="Searching medicines..." />
            </p>
          ) : null}

          {effectiveStatus === "empty" ? (
            <p className="search-status" role="status">
              No medicines match “{query.trim()}”. Check the spelling or try a different name.
            </p>
          ) : null}

          {effectiveStatus === "error" ? (
            <p className="search-status" role="alert">
              {errorMessage}
            </p>
          ) : null}

          {effectiveStatus === "results"
            ? results.map((product, index) => {
                const detailPath = productDetailPath(product.id);
                return (
                  <SiteLink
                    key={product.id}
                    role="option"
                    aria-selected={index === activeIndex}
                    className="search-result"
                    href={detailPath}
                    onClick={() => {
                      setIsOpen(false);
                      onResultNavigate?.(detailPath);
                    }}
                  >
                    <span className="search-result-name">
                      {product.name}
                      {product.prescriptionRequired ? " (Rx)" : ""}
                    </span>
                    <span className="search-result-meta">{product.category.name}</span>
                    <span className="search-result-price">{formatPrice(product)}</span>
                  </SiteLink>
                );
              })
            : null}

          {effectiveStatus === "results" ? (
            <p className="search-hint">Press Enter to see all matching medicines in the catalog.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
