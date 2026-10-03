import { FlaskIcon, PillIcon, ShieldHeartIcon, BookIcon, SupportIcon } from "./icons";
import { SiteLink } from "../routing/SiteLink";
import type { Category } from "../pharmacy/pharmacy-api";
import { storefrontPath } from "../pharmacy/pharmacy-catalog";

const RAIL_ICONS = [PillIcon, FlaskIcon, ShieldHeartIcon, BookIcon, SupportIcon];

/**
 * Demo-approved category imagery, keyed by stable category slug — the same
 * mapping the HomePage category showcase uses. Categories without an entry
 * fall back to the consistent OncoEasy icon glyph, so nothing is invented.
 */
const CATEGORY_IMAGES: Record<string, string> = {
  "oncology-medicines": "/assets/categories/oncology-medicines.jpg",
  "supportive-care": "/assets/categories/supportive-care.jpg",
  "pain-symptom-care": "/assets/categories/pain-care.jpg",
  "nutrition-wellness": "/assets/categories/nutrition-wellness.jpg",
  "medical-devices": "/assets/categories/medical-devices.jpg"
};

/**
 * Category navigation rail for the pharmacy storefront. Categories come from
 * the live catalog API — nothing is hardcoded. A category renders as an image
 * thumb when the approved asset set has one for its slug; otherwise it falls
 * back to a consistent OncoEasy icon glyph keyed by the category name.
 */
export function CategoryRail({
  categories,
  activeSlug,
  currentFilters,
  onNavigate
}: {
  categories: Category[];
  /** Slug of the currently selected category, or "" for "All medicines". */
  activeSlug: string;
  /** Current storefront filters, merged into each category link. */
  currentFilters: { search: string; prescriptionRequired: boolean | undefined; coldChainRequired: boolean | undefined };
  onNavigate?: () => void;
}) {
  return (
    <nav className="category-rail-wrap" aria-label="Browse by category">
      <div className="category-rail">
        <SiteLink
          href={storefrontPath(
            { ...currentFilters, category: "", page: 1 },
            { category: "" }
          )}
          className={`category-rail-chip${activeSlug === "" ? " is-active" : ""}`}
          aria-current={activeSlug === "" ? "page" : undefined}
          onClick={onNavigate}
        >
          <span className="category-rail-icon category-rail-icon-all" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="4" width="7" height="7" rx="1.6" />
              <rect x="13" y="4" width="7" height="7" rx="1.6" />
              <rect x="4" y="13" width="7" height="7" rx="1.6" />
              <rect x="13" y="13" width="7" height="7" rx="1.6" />
            </svg>
          </span>
          <span className="category-rail-name">All medicines</span>
        </SiteLink>

        {categories.map((category, index) => {
          const isActive = activeSlug === category.slug;
          const Icon = RAIL_ICONS[index % RAIL_ICONS.length];
          const image = CATEGORY_IMAGES[category.slug];
          return (
            <SiteLink
              key={category.id}
              href={storefrontPath(
                { ...currentFilters, category: category.slug, page: 1 },
                { category: category.slug }
              )}
              className={`category-rail-chip${isActive ? " is-active" : ""}`}
              aria-current={isActive ? "page" : undefined}
              onClick={onNavigate}
            >
              <span className={`category-rail-icon category-rail-icon-${index % 5}`} aria-hidden="true">
                {image ? (
                  <img src={image} alt="" width={30} height={30} loading="lazy" decoding="async" />
                ) : (
                  <Icon size={22} />
                )}
              </span>
              <span className="category-rail-name">{category.name}</span>
            </SiteLink>
          );
        })}
      </div>
    </nav>
  );
}
