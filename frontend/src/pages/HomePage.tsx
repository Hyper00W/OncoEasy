import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { listCategories, listProducts, type Category, type Product } from "../pharmacy/pharmacy-api";
import {
  listPublicTestimonials,
  type PublicTestimonial
} from "../testimonials/testimonials-api";
import { MedicineSearch } from "../components/MedicineSearch";
import { ProductCard } from "../components/ProductCard";
import { SiteTestimonialCard } from "../components/SiteTestimonialCard";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { Container, LoadingState } from "../components/ui";
import { Reveal } from "../motion/motion";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronRightIcon,
  DocumentIcon,
  FlaskIcon,
  LockIcon,
  MessageCircleIcon,
  PillIcon,
  SearchIcon,
  ShieldHeartIcon,
  StethoscopeIcon,
  ThermometerIcon,
  TruckIcon,
  UploadIcon,
  UsersIcon
} from "../components/icons";

type Navigate = (path: string) => void;

/**
 * Homepage (Phase 6.6B) — visual blueprint migrated from the approved
 * OncoEasy demo, rebuilt on the current real APIs. Sections map to live
 * backend data (catalog, categories, testimonials); nothing is mocked and
 * no medicine imagery is fabricated. All imagery comes from the demo's
 * approved asset set in /public/assets.
 */

/**
 * Demo-approved category imagery, keyed by stable category slug. Categories
 * without an entry render as typographic cards — no image is invented.
 */
const CATEGORY_IMAGES: Record<string, string> = {
  "oncology-medicines": "/assets/categories/oncology-medicines.jpg",
  "supportive-care": "/assets/categories/supportive-care.jpg",
  "pain-symptom-care": "/assets/categories/pain-care.jpg",
  "nutrition-wellness": "/assets/categories/nutrition-wellness.jpg",
  "medical-devices": "/assets/categories/medical-devices.jpg"
};

const CATEGORY_NOTES: Record<string, string> = {
  "oncology-medicines": "Specialist care",
  "supportive-care": "Everyday comfort",
  "pain-symptom-care": "Feel supported",
  "nutrition-wellness": "Nourish well",
  "medical-devices": "Care essentials"
};

const POPULAR_SEARCHES = ["Oncology medicines", "Supportive care", "Nutrition", "Devices"];

const TRUST_POINTS = [
  {
    title: "100% genuine medicines",
    description: "Sourced from authorized oncology pharmaceutical manufacturers with batch tracking.",
    Icon: ShieldHeartIcon
  },
  {
    title: "Cold-chain packaging",
    description: "Temperature-controlled transport for biologicals and heat-sensitive therapy.",
    Icon: ThermometerIcon
  },
  {
    title: "Prescription verification",
    description: "Every prescription is reviewed by our oncology pharmacists before fulfillment.",
    Icon: LockIcon
  },
  {
    title: "Discreet & safe delivery",
    description: "Tamper-evident medical packages delivered with proof of handover.",
    Icon: TruckIcon
  }
];

const CARE_RECORDS = [
  {
    title: "Request lab tests & scans",
    detail: "Choose from the published catalog with a preferred date.",
    Icon: FlaskIcon,
    tone: "blue" as const
  },
  {
    title: "Track each booking",
    detail: "See collection, processing, and completion status as it happens.",
    Icon: DocumentIcon,
    tone: "peach" as const
  },
  {
    title: "Collect reports",
    detail: "Reports are delivered against each booking in your workspace.",
    Icon: DocumentIcon,
    tone: "mint" as const
  }
];

export function HomePage({ navigate }: { navigate: Navigate }) {
  // Medicine search submitted from the header or hero feeds the pharmacy
  // section below, so visitors land on results instead of an unfiltered list.
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="site-page">
      <SiteHeader navigate={navigate} />

      <main className="site-main">
        <Hero navigate={navigate} onSearch={setSearchQuery} />
        <CategoryShowcase navigate={navigate} />
        <PromoCarousel navigate={navigate} />
        <PharmacySection navigate={navigate} search={searchQuery} />
        <ConsultationSection navigate={navigate} />
        <CareBookingSection navigate={navigate} />
        <CareRecordsSection navigate={navigate} />
        <WhyOncoSection />
        <TestimonialsSection />
        <SupportCta navigate={navigate} />
      </main>

      <SiteFooter navigate={navigate} searchQuery={searchQuery} />
    </div>
  );
}

/* ---------- Hero ---------- */

function Hero({ navigate, onSearch }: { navigate: Navigate; onSearch: (query: string) => void }) {
  return (
    <section className="hero-section">
      <div className="container hero-grid">
        <div className="hero-copy">
          <div className="hero-kicker">
            <span className="kicker-line" aria-hidden="true" /> Oncology Pharmacy &amp; Care
          </div>
          <h1>
            Oncology medicines,
            <br />
            <em>made easier.</em>
          </h1>
          <p>
            Find trusted medicines, upload prescriptions, and access the care you need — all in
            one place.
          </p>

          <div className="hero-search-wrap">
            <MedicineSearch
              idPrefix="hero-search"
              placeholder="Search medicines, oncology products..."
              onSubmit={(query) => {
                onSearch(query);
                if (query) navigate(`/pharmacy?search=${encodeURIComponent(query)}`);
              }}
            />
            <div className="search-hints">
              <span>Popular searches:</span>
              {POPULAR_SEARCHES.map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => {
                    onSearch(term);
                    navigate(`/pharmacy?search=${encodeURIComponent(term)}`);
                  }}
                >
                  {term}
                </button>
              ))}
            </div>
          </div>

          <div className="hero-prescription">
            <div className="upload-icon" aria-hidden="true">
              <UploadIcon size={20} />
            </div>
            <div>
              <strong>Have a prescription?</strong>
              <span>Upload it and our oncology pharmacists will prepare your order.</span>
            </div>
            <button type="button" onClick={() => navigate("/patient/pharmacy?tab=prescriptions")}>
              Upload prescription <ArrowRightIcon size={16} />
            </button>
          </div>
        </div>

        <div className="pharmacy-hero-visual">
          <div className="hero-image-frame">
            <span className="hero-floating-badge">
              <ShieldHeartIcon size={16} /> Verified Oncology Pharmacy
            </span>
            <img
              src="/assets/hero/doctor-patient.webp"
              alt="An oncology doctor talking with her patient"
              width={612}
              height={408}
              fetchPriority="high"
              decoding="async"
            />
            <div className="hero-image-overlay">
              <h3>Certified cancer therapeutics</h3>
              <p>
                Cold-chain biologicals, oral chemotherapy, and oncology supportive care delivered
                with clinical oversight.
              </p>
            </div>
          </div>

          <div className="hero-pills-row">
            <div className="hero-mini-banner">
              <div className="hero-mini-icon" aria-hidden="true">
                <ThermometerIcon size={20} />
              </div>
              <div className="hero-mini-text">
                <strong>Cold-chain verified</strong>
                <span>For biologicals &amp; chemo</span>
              </div>
            </div>

            <div className="hero-mini-banner">
              <div className="hero-mini-icon peach-tone" aria-hidden="true">
                <TruckIcon size={20} />
              </div>
              <div className="hero-mini-text">
                <strong>Priority care dispatch</strong>
                <span>With proof of delivery</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Category showcase (demo "Shop Oncology Care") ---------- */

function CategoryShowcase({ navigate }: { navigate: Navigate }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listCategories()
      .then((items) => {
        if (!cancelled) {
          setCategories(items);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="quick-section" aria-labelledby="categories-heading">
      <Container>
        <Reveal as="div" className="section-heading compact">
          <div>
            <span className="eyebrow teal-text">Specialized therapeutics</span>
            <h2 id="categories-heading">Shop oncology care</h2>
          </div>
          <a
            className="text-link"
            href="/pharmacy"
            onClick={(event) => {
              event.preventDefault();
              navigate("/pharmacy");
            }}
          >
            Browse full catalog <ArrowRightIcon size={16} />
          </a>
        </Reveal>

        {!loaded ? (
          <div className="category-grid" aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => (
              <div className="category-skeleton" key={index}>
                <div className="category-skeleton-media" />
                <div className="category-skeleton-line" />
                <div className="category-skeleton-line category-skeleton-line-short" />
              </div>
            ))}
          </div>
        ) : categories.length === 0 ? (
          <p className="empty-state" role="status">
            Categories will appear here once the pharmacy catalog is published.
          </p>
        ) : (
          <div className="category-grid">
            {categories.map((category, index) => {
              const image = CATEGORY_IMAGES[category.slug];
              const isFirst = index === 0;
              return (
                <Reveal
                  as="a"
                  className={`category-card${isFirst ? " featured-category" : ""}`}
                  key={category.id}
                  delay={index * 60}
                  href={`/pharmacy?category=${encodeURIComponent(category.slug)}`}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(`/pharmacy?category=${encodeURIComponent(category.slug)}`);
                  }}
                >
                  {image ? (
                    <span className="category-card-img">
                      <img
                        src={image}
                        alt=""
                        width={560}
                        height={320}
                        loading="lazy"
                        decoding="async"
                      />
                    </span>
                  ) : (
                    <span className="category-card-img category-card-img-text" aria-hidden="true">
                      <PillIcon size={28} />
                    </span>
                  )}
                  <b>{category.name}</b>
                  <small>{CATEGORY_NOTES[category.slug] ?? "Explore the catalog"}</small>
                  <ArrowRightIcon className="category-arrow" size={16} />
                </Reveal>
              );
            })}
          </div>
        )}
      </Container>
    </section>
  );
}

/* ---------- Promo banner carousel (demo slides, current routes) ---------- */

const PROMO_SLIDES = [
  {
    id: "delivery",
    tag: "Hospital & home care delivery",
    title: "Precision temperature-controlled",
    highlight: "oncology delivery",
    description:
      "Chemotherapy, biologics, and targeted therapies travel in validated thermal packaging with cold-chain handling from pharmacy to doorstep.",
    ctaText: "Explore medicines",
    ctaRoute: "/pharmacy",
    image: "/assets/banner/cold-chain-delivery.jpg",
    alt: "Cold-chain medicine delivery packaging",
    trustText: "Tamper-sealed packaging · Cold-chain handling"
  },
  {
    id: "medicines",
    tag: "Licensed oncology pharmacists",
    title: "Specialty cancer pharmacy &",
    highlight: "therapy fulfillment",
    description:
      "Access hard-to-find oncology medications and supportive care essentials — every prescription reviewed before it leaves the pharmacy.",
    ctaText: "Search the catalog",
    ctaRoute: "/pharmacy",
    image: "/assets/banner/specialty-medicines.jpg",
    alt: "Specialty oncology medicines",
    trustText: "Prescription verified before fulfillment"
  },
  {
    id: "patientcare",
    tag: "Patient-first oncology care",
    title: "Compassionate guidance &",
    highlight: "cost support",
    description:
      "Our support desk helps coordinate refills around your treatment cycle and points you to assistance programs that can reduce costs.",
    ctaText: "Explore patient assistance",
    ctaRoute: "/patient/pap",
    image: "/assets/banner/patient-care.jpg",
    alt: "A care provider supporting a patient",
    trustText: "Cycle-aware refills · Dedicated support"
  }
];

function PromoCarousel({ navigate }: { navigate: Navigate }) {
  // active = slide fading in / shown. leaving = the previous slide held fully
  // opaque underneath until the crossfade completes, so the navy base never
  // flashes through the middle of the transition.
  const [state, setState] = useState<{ active: number; leaving: number | null }>({
    active: 0,
    leaving: null
  });
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      setState(({ active }) => ({
        active: (active + 1) % PROMO_SLIDES.length,
        leaving: active
      }));
    }, 6000);
    return () => window.clearInterval(timer);
  }, [paused]);

  // Once the incoming slide is fully opaque it covers the outgoing one, so
  // the leaving class can clear and the old slide returns to the hidden base
  // state with no visible fade-out over the background.
  useEffect(() => {
    if (state.leaving === null) return;
    const timer = window.setTimeout(() => {
      setState((current) => (current.leaving === null ? current : { ...current, leaving: null }));
    }, 520);
    return () => window.clearTimeout(timer);
  }, [state.leaving]);

  const step = (delta: number) =>
    setState(({ active }) => ({
      active: (active + delta + PROMO_SLIDES.length) % PROMO_SLIDES.length,
      leaving: active
    }));

  const goToIndex = (index: number) =>
    setState(({ active }) =>
      index === active ? { active, leaving: null } : { active: index, leaving: active }
    );  return (
    <Reveal as="section" className="feature-section"
      aria-roledescription="carousel"
      aria-label="OncoEasy highlights"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="container">
        <div className="promo-carousel-wrap">
          {/* Fixed-frame viewport: its aspect ratio (not slide content) sets the
              carousel size, so slide changes can never resize the layout. Slides
              crossfade in place instead of sliding. */}
          <div className="promo-carousel-viewport">
            {/* Slides are stacked and crossfade via CSS (.promo-slide active
                state) — no inline transform needed for the fade pattern. */}
            <div className="promo-carousel-track">
              {PROMO_SLIDES.map((slide, index) => (
                <div
                  key={slide.id}
                  className={`promo-slide${index === state.active ? " active-slide" : ""}${
                    index === state.leaving ? " leaving-slide" : ""
                  }`}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${index + 1} of ${PROMO_SLIDES.length}`}
                  aria-hidden={index !== state.active}
                >
                  <div className="promo-content">
                    <span className="eyebrow yellow-text promo-tag">{slide.tag}</span>
                    <h2>
                      {slide.title} <em>{slide.highlight}</em>
                    </h2>
                    <p>{slide.description}</p>
                    <div>
                      <button
                        type="button"
                        className="button"
                        tabIndex={index === state.active ? 0 : -1}
                        onClick={() => navigate(slide.ctaRoute)}
                      >
                        {slide.ctaText} <ArrowRightIcon size={16} />
                      </button>
                    </div>
                    <div className="feature-trust">
                      <ShieldHeartIcon size={16} />
                      <span>{slide.trustText}</span>
                    </div>
                  </div>

                  <div className="promo-media">
                    <img
                      src={slide.image}
                      alt={slide.alt}
                      width={612}
                      height={408}
                      loading={index === 0 ? "eager" : "lazy"}
                      decoding="async"
                      tabIndex={-1}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="carousel-nav-btn prev"
            onClick={() => step(-1)}
            aria-label="Previous slide"
          >
            <ChevronRightIcon size={22} style={{ transform: "rotate(180deg)" }} />
          </button>
          <button
            type="button"
            className="carousel-nav-btn next"
            onClick={() => step(1)}
            aria-label="Next slide"
          >
            <ChevronRightIcon size={22} />
          </button>

          <div className="carousel-dots">
            {PROMO_SLIDES.map((slide, index) => (
              <button
                key={`dot-${slide.id}`}
                type="button"
                className={`carousel-dot${index === state.active ? " active" : ""}`}
                aria-label={`Go to slide ${index + 1}`}
                aria-current={index === state.active || undefined}
                onClick={() => goToIndex(index)}
              />
            ))}
          </div>
        </div>
      </div>
    </Reveal>
  );
}

/* ---------- Pharmacy (real catalog data) ---------- */

function PharmacySection({ navigate, search }: { navigate: Navigate; search?: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const requestTokenRef = useRef(0);
  const [searchInput, setSearchInput] = useState(search ?? "");
  const [prevSearch, setPrevSearch] = useState(search ?? "");
  const activeSearch = search ?? "";

  if (prevSearch !== activeSearch) {
    setPrevSearch(activeSearch);
    setSearchInput(activeSearch);
    setIsLoading(true);
  }

  useEffect(() => {
    const requestToken = ++requestTokenRef.current;
    listProducts({ search: searchInput || undefined, page: 1, pageSize: 8 })
      .then((response) => {
        if (requestTokenRef.current !== requestToken) return;
        setProducts(response.items);
        setError(null);
        setIsLoading(false);
      })
      .catch((requestError: unknown) => {
        if (requestTokenRef.current !== requestToken) return;
        setError(
          requestError instanceof ApiError
            ? requestError.message
            : "The catalog is unavailable right now."
        );
        setIsLoading(false);
      });
  }, [searchInput, retryToken]);

  return (
    <section className="store-section" id="store" aria-labelledby="store-heading">
      <Container>
        <Reveal as="div" className="section-heading">
          <div>
            <span className="eyebrow teal-text">OncoEasy store</span>
            <h2 id="store-heading">Popular medicines</h2>
            <p className="section-description">
              Prescription oncology therapeutics and supportive care essentials verified by our
              clinical team.
            </p>
          </div>
          <a
            className="text-link"
            href={
              searchInput ? `/pharmacy?search=${encodeURIComponent(searchInput)}` : "/pharmacy"
            }
            onClick={(event) => {
              event.preventDefault();
              navigate(searchInput ? `/pharmacy?search=${encodeURIComponent(searchInput)}` : "/pharmacy");
            }}
          >
            See all medicines <ArrowRightIcon size={16} />
          </a>
        </Reveal>

        {searchInput ? (
          <p className="result-note" role="status">
            Showing results for “{searchInput}”{" "}
            <button type="button" onClick={() => setSearchInput("")} aria-label="Clear search">
              <SearchIcon size={14} style={{ display: "none" }} />
              ✕
            </button>
          </p>
        ) : null}

        {isLoading ? (
          <div className="product-grid" aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => (
              <div className="product-skeleton" key={index}>
                <div className="product-skeleton-media" />
                <div className="product-skeleton-line product-skeleton-line-lg" />
                <div className="product-skeleton-line" />
                <div className="product-skeleton-line product-skeleton-line-short" />
              </div>
            ))}
          </div>
        ) : error && products.length === 0 ? (
          <div className="error-state" role="alert">
            <p>{error}</p>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                setError(null);
                setIsLoading(true);
                setRetryToken((current) => current + 1);
              }}
            >
              Try again
            </button>
          </div>
        ) : products.length === 0 ? (
          <div className="empty-products">
            <SearchIcon size={24} />
            <b>{searchInput ? "No medicines found" : "Catalog is being stocked"}</b>
            <span>
              {searchInput
                ? "Try searching by brand name or generic compound."
                : "Medicines will appear here as soon as the pharmacy catalog is published."}
            </span>
          </div>
        ) : (
          <div className="product-grid">
            {products.map((product, index) => (
              <Reveal key={product.id} as="div" delay={Math.min(index, 7) * 55} className="reveal-fade">
                <ProductCard product={product} />
              </Reveal>
            ))}
          </div>
        )}
      </Container>
    </section>
  );
}

/* ---------- Doctors + prescription CTA (demo layout, honest content) ---------- */

const DOCTOR_PREVIEWS = [
  {
    image: "/assets/consultation/doctor-02.avif",
    alt: "Oncology specialist available for consultation",
    title: "Oncology specialists",
    detail: "Treatment guidance from verified doctors",
    availability: "Book from published availability"
  },
  {
    image: "/assets/consultation/doctor-01.avif",
    alt: "Supportive care physician available for consultation",
    title: "Supportive care physicians",
    detail: "Everyday wellbeing during treatment",
    availability: "In-clinic & phone consultations"
  }
];

function ConsultationSection({ navigate }: { navigate: Navigate }) {
  return (
    <section className="care-services" id="doctors" aria-labelledby="doctors-heading">
      <div className="container services-grid">
        <Reveal as="div" className="service-intro">
          <span className="eyebrow teal-text">Specialist support</span>
          <h2 id="doctors-heading">Oncology specialists &amp; consultations</h2>
          <p>
            Book in-clinic or phone consultations with verified doctors and keep your visit
            history in one place.
          </p>
          <button
            type="button"
            className="outline-button"
            onClick={() => navigate("/patient/consultations")}
          >
            Book a consultation <ArrowRightIcon size={16} />
          </button>
        </Reveal>

        {DOCTOR_PREVIEWS.map((doctor, index) => (
          <Reveal as="div" className="doctor-preview" key={doctor.title} delay={120 + index * 90} variant="up">
            <div className="doctor-avatar-real">
              <img src={doctor.image} alt={doctor.alt} width={64} height={64} loading="lazy" decoding="async" />
            </div>
            <div className="doctor-info">
              <strong>{doctor.title}</strong>
              <span>{doctor.detail}</span>
              <small>
                <i aria-hidden="true" /> {doctor.availability}
              </small>
            </div>
            <button
              type="button"
              className="circle-button"
              onClick={() => navigate("/patient/consultations")}
              aria-label={`Book a ${doctor.title.toLowerCase()} consultation`}
            >
              <ArrowRightIcon size={17} />
            </button>
          </Reveal>
        ))}
      </div>

      <div className="container prescription-cta-wrap">
        <Reveal as="div" className="prescription-cta-card" variant="scale">
          <div>
            <span className="eyebrow teal-text">Instant pharmacist review</span>
            <h3>Need help ordering with your prescription?</h3>
            <p>
              Skip the search. Upload your doctor’s prescription slip or discharge summary — our
              oncology pharmacy team confirms availability, checks cold-chain requirements, and
              reviews every order before fulfillment.
            </p>
            <button
              type="button"
              className="button"
              onClick={() => navigate("/patient/pharmacy?tab=prescriptions")}
            >
              <UploadIcon size={17} /> Upload prescription
            </button>
          </div>
          <div className="prescription-cta-media">
            <img
              src="/assets/prescription/prescription-upload.png"
              alt="Uploading a doctor's prescription"
              width={320}
              height={340}
              loading="lazy"
              decoding="async"
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- Care booking (demo appointment panel, current scope) ---------- */

function CareBookingSection({ navigate }: { navigate: Navigate }) {
  return (
    <section className="booking-section" aria-labelledby="booking-heading">
      <div className="container booking-grid">
        <Reveal as="div">
          <span className="eyebrow yellow-text">Care booking</span>
          <h2 id="booking-heading">
            Consultations that move
            <br />
            <em>at your pace.</em>
          </h2>
          <p>
            Book an in-clinic or phone consultation with verified doctors. Your appointments stay
            organized in your patient workspace.
          </p>
          <button type="button" className="button" onClick={() => navigate("/patient/consultations")}>
            <StethoscopeIcon size={17} /> Book an appointment
          </button>
        </Reveal>
        <Reveal as="div" className="booking-panel" delay={110}>
          <div className="panel-top">
            <span>Book a consultation</span>
            <span className="step-count" aria-hidden="true">
              1 <i /> 2 <i /> 3
            </span>
          </div>
          <div className="booking-options">
            <div className="booking-option selected">
              <StethoscopeIcon size={17} />
              <span>
                <b>Oncology specialist</b>
                <small>For treatment guidance</small>
              </span>
              <CheckIcon size={16} />
            </div>
            <div className="booking-option">
              <ShieldHeartIcon size={17} />
              <span>
                <b>Supportive care</b>
                <small>For everyday wellbeing</small>
              </span>
            </div>
          </div>
          <div className="panel-footer">
            <StethoscopeIcon size={15} /> In-clinic &amp; phone consultations available
          </div>
          <button
            type="button"
            className="button booking-panel-cta"
            onClick={() => navigate("/patient/consultations")}
          >
            Choose a slot <ArrowRightIcon size={15} />
          </button>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- Care records (demo reports section → current labs scope) ---------- */

function CareRecordsSection({ navigate }: { navigate: Navigate }) {
  return (
    <section className="records-section" aria-labelledby="records-heading">
      <div className="container records-grid">
        <Reveal as="div">
          <span className="eyebrow teal-text">Digital care records</span>
          <h2 id="records-heading">
            Your medical reports,
            <br />
            <em>always within reach.</em>
          </h2>
          <p>
            Request lab tests and scans, follow each booking, and collect reports against your
            bookings — all in one secure place.
          </p>
          <button type="button" className="outline-button" onClick={() => navigate("/patient/labs")}>
            Explore lab tests <ArrowRightIcon size={16} />
          </button>
        </Reveal>
        <Reveal as="div" className="report-list" delay={110}>
          {CARE_RECORDS.map(({ title, detail, Icon, tone }) => (
            <button
              type="button"
              className="report-item"
              key={title}
              onClick={() => navigate("/patient/labs")}
            >
              <span className={`report-icon ${tone}`} aria-hidden="true">
                <Icon size={19} />
              </span>
              <span>
                <b>{title}</b>
                <small>{detail}</small>
              </span>
              <ChevronRightIcon size={18} />
            </button>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- Why OncoEasy (demo trust strip) ---------- */

function WhyOncoSection() {
  return (
    <section className="quick-section why-section" aria-labelledby="why-heading">
      <Container>
        <Reveal as="div" className="section-heading compact">
          <div>
            <span className="eyebrow teal-text">Our quality promise</span>
            <h2 id="why-heading">Why patients &amp; caregivers trust OncoEasy</h2>
          </div>
        </Reveal>
        <div className="why-onco-grid">
          {TRUST_POINTS.map(({ title, description, Icon }, index) => (
            <Reveal as="div" className="why-onco-card" key={title} delay={index * 70}>
              <div className="why-icon" aria-hidden="true">
                <Icon size={22} />
              </div>
              <h3>{title}</h3>
              <p>{description}</p>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ---------- Testimonials (real API, unchanged) ---------- */

function TestimonialsSection() {
  const [testimonials, setTestimonials] = useState<PublicTestimonial[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    listPublicTestimonials({ page: 1, pageSize: 8 })
      .then((response) => {
        if (!cancelled) {
          setTestimonials(response.items);
          setError(null);
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(
            requestError instanceof ApiError
              ? requestError.message
              : "Testimonials are unavailable right now."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return (
    <section className="site-section site-section-sunken" aria-labelledby="testimonials-heading">
      <Container>
        <Reveal as="div" className="section-heading compact">
          <div>
            <span className="eyebrow teal-text">Community</span>
            <h2 id="testimonials-heading">Voices from the people we support</h2>
          </div>
        </Reveal>
        <div id="testimonials-heading">
          {isLoading ? (
            <LoadingState label="Loading testimonials..." />
          ) : error ? (
            <div className="error-state" role="alert">
              <p>{error}</p>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => {
                  setError(null);
                  setIsLoading(true);
                  setReloadToken((current) => current + 1);
                }}
              >
                Try again
              </button>
            </div>
          ) : testimonials.length === 0 ? (
            <div className="empty-state-block">
              <p className="empty-state-title">No testimonials have been published yet.</p>
              <p className="empty-state-hint">Please check back soon.</p>
            </div>
          ) : (
            <div className="testimonial-rail" aria-label="Published testimonials">
              {testimonials.map((testimonial, index) => (
                <Reveal key={testimonial.testimonialId} as="div" delay={Math.min(index, 5) * 70} className="reveal-fade">
                  <SiteTestimonialCard testimonial={testimonial} />
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </Container>
    </section>
  );
}

/* ---------- Support CTA (current navy panel) ---------- */

function SupportCta({ navigate }: { navigate: Navigate }) {
  return (
    <section className="support-cta">
      <Container className="support-cta-inner">
        <Reveal as="div">
          <h2>Questions about your treatment?</h2>
          <p>
            Sign in and start a chat with the OncoEasy team. We can help with medicines,
            consultations, lab bookings, and assistance applications.
          </p>
        </Reveal>
        <Reveal as="div" className="support-cta-actions" delay={90}>
          <button className="button button-light" type="button" onClick={() => navigate("/patient/chat")}>
            <MessageCircleIcon size={16} /> Chat with support
          </button>
          <button className="button button-outline-light" type="button" onClick={() => navigate("/auth")}>
            <UsersIcon size={16} /> Sign in
          </button>
        </Reveal>
      </Container>
    </section>
  );
}
