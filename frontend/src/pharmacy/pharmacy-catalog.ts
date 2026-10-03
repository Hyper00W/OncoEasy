/**
 * Shared helpers for the public pharmacy storefront (Phase 6.2).
 *
 * The storefront URL is the single source of truth for the catalog state:
 * every filter/page change is expressed as a URL, so results are shareable
 * and browser back/forward works. Only query parameters the backend catalog
 * actually supports (Phase 1.7.5) are ever emitted here.
 */

export const STOREFRONT_PATH = "/pharmacy";

/** Catalog filters mirrored onto /pharmacy query parameters. */
export type CatalogFilters = {
  search: string;
  category: string;
  prescriptionRequired: boolean | undefined;
  coldChainRequired: boolean | undefined;
  page: number;
};

export function parseCatalogFilters(locationSearch: string): CatalogFilters {
  const params = new URLSearchParams(locationSearch);
  const rawPage = Number.parseInt(params.get("page") ?? "1", 10);

  return {
    search: params.get("search") ?? "",
    category: params.get("category") ?? "",
    prescriptionRequired: parseBooleanParam(params.get("prescriptionRequired")),
    coldChainRequired: parseBooleanParam(params.get("coldChainRequired")),
    page: Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(rawPage, 10_000) : 1
  };
}

function parseBooleanParam(value: string | null): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/**
 * Builds a storefront URL from merged filters. Default values are omitted so
 * clean URLs stay clean, and page 1 is never emitted.
 */
export function storefrontPath(current: CatalogFilters, next: Partial<CatalogFilters> = {}): string {
  const merged: CatalogFilters = { ...current, ...next };
  const params = new URLSearchParams();

  if (merged.search.trim()) params.set("search", merged.search.trim());
  if (merged.category) params.set("category", merged.category);
  if (merged.prescriptionRequired !== undefined) {
    params.set("prescriptionRequired", String(merged.prescriptionRequired));
  }
  if (merged.coldChainRequired !== undefined) {
    params.set("coldChainRequired", String(merged.coldChainRequired));
  }
  if (merged.page > 1) params.set("page", String(merged.page));

  const query = params.toString();
  return query ? `${STOREFRONT_PATH}?${query}` : STOREFRONT_PATH;
}

export function productDetailPath(productId: string): string {
  return `${STOREFRONT_PATH}/products/${productId}`;
}

/** Count of currently active non-page filters, for "clear all" affordances. */
export function activeFilterCount(filters: CatalogFilters): number {
  let count = 0;
  if (filters.search.trim()) count += 1;
  if (filters.category) count += 1;
  if (filters.prescriptionRequired !== undefined) count += 1;
  if (filters.coldChainRequired !== undefined) count += 1;
  return count;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£"
};

/**
 * Formats a precision-safe Decimal string with its currency symbol. Backend
 * prices arrive as strings (Phase 1.7.5) and are never re-parsed into floats.
 */
export function formatMoney(currency: string, price: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return `${symbol}${price}`;
}
