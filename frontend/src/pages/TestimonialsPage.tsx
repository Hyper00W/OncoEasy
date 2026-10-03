import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PatientPageShell } from "../shell/PatientPageShell";
import { Alert, BackLink, Button, LoadingState, PageIntro, Panel } from "../components/ui";
import { listPublicTestimonials, testimonialMediaUrl, type Paginated, type PublicTestimonial } from "../testimonials/testimonials-api";
import { Reveal } from "../motion/motion";

type Navigate = (path: string) => void;

const pageSize = 12;

/**
 * Patient-facing testimonials. Every card comes from GET /api/v1/testimonials —
 * nothing is hardcoded: the number of cards, their content, and their media all
 * mirror the backend's published testimonials at request time. Only the first
 * page is requested up front; further pages load on demand.
 */
export function TestimonialsPage({ navigate }: { navigate: Navigate }) {
  const { signOut } = useAuth();
  const [testimonials, setTestimonials] = useState<PublicTestimonial[]>([]);
  const [pagination, setPagination] = useState<Paginated<PublicTestimonial>["pagination"]>({ page: 1, pageSize, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // `isLoading` is set by the initial state and by the retry handler; the effect
  // only synchronises fetched data, so it never sets state synchronously.
  useEffect(() => {
    let cancelled = false;

    listPublicTestimonials({ page: 1, pageSize })
      .then((response) => {
        if (!cancelled) {
          setTestimonials(response.items);
          setPagination(response.pagination);
          setError(null);
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(getErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function loadMore(): void {
    // Guard against duplicate in-flight requests from repeated clicks.
    if (isLoadingMore || pagination.page >= pagination.totalPages) return;
    setIsLoadingMore(true);
    setError(null);

    listPublicTestimonials({ page: pagination.page + 1, pageSize })
      .then((response) => {
        setTestimonials((current) => {
          const known = new Set(current.map((item) => item.testimonialId));
          return [...current, ...response.items.filter((item) => !known.has(item.testimonialId))];
        });
        setPagination(response.pagination);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setIsLoadingMore(false));
  }

  function handleSignOut(): void {
    signOut();
    navigate("/");
  }
  void handleSignOut;

  const hasMore = pagination.page < pagination.totalPages;

  return (
    <PatientPageShell navigate={navigate} activePath="/patient/testimonials" className="testimonials-page"
      backSlot={<BackLink navigate={navigate} fallback="/patient" label="Back to dashboard" />}>
      <PageIntro
        eyebrow="OncoEasy community"
        title="Testimonials"
        description="Experiences shared by the people we support."
        crumbs={[
          { label: "Dashboard", href: "/patient" },
          { label: "Testimonials" }
        ]}
      />

      {error ? (
        <>
          <Alert>{error}</Alert>
          <Button type="button" onClick={() => { setError(null); setIsLoading(true); setReloadToken((current) => current + 1); }}>
            Retry
          </Button>
        </>
      ) : null}

      {isLoading ? (
        <LoadingState label="Loading testimonials..." />
      ) : !error && testimonials.length === 0 ? (
        <Panel>
          <p className="empty-state" role="status">No testimonials have been published yet. Please check back soon.</p>
        </Panel>
      ) : null}

      {testimonials.length > 0 ? (
        <>
          <p className="muted" role="status" aria-live="polite">
            Showing {testimonials.length} of {pagination.total} testimonials
          </p>
          <section className="testimonials-grid" aria-label="Published testimonials" aria-busy={isLoadingMore}>
            {testimonials.map((testimonial, index) => (
              <Reveal key={testimonial.testimonialId} as="div" delay={Math.min(index % 9, 5) * 60} className="reveal-fade">
                <TestimonialCard testimonial={testimonial} />
              </Reveal>
            ))}
          </section>
          {hasMore ? (
            <div className="button-row">
              <Button type="button" disabled={isLoadingMore} onClick={loadMore}>
                {isLoadingMore ? <LoadingState label="Loading more..." /> : `Load more testimonials (${pagination.total - testimonials.length} remaining)`}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </PatientPageShell>
  );
}

function TestimonialCard({ testimonial }: { testimonial: PublicTestimonial }) {
  return (
    <Panel>
      <article className="testimonial-card">
        {testimonial.media ? <TestimonialMedia testimonial={testimonial} /> : null}
        <p className="eyebrow">{testimonial.type === "VIDEO" ? "Video story" : "Photo story"}</p>
        <h2>{testimonial.title}</h2>
        <p>{testimonial.description}</p>
        <p className="muted">— {testimonial.displayName}</p>
      </article>
    </Panel>
  );
}

function TestimonialMedia({ testimonial }: { testimonial: PublicTestimonial }) {
  const [hasFailed, setHasFailed] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Preferred: backend delivery path (works in development and production).
  // Fallback: the provider's temporary reference, when it is browser-loadable.
  const deliveryUrl = testimonialMediaUrl(testimonial.media?.deliveryUrl);
  const source = deliveryUrl ?? testimonial.media?.access?.reference ?? null;
  const attemptSuffix = attempt > 0 ? `${source?.includes("?") ? "&" : "?"}retry=${attempt}` : "";
  const label = testimonial.type === "VIDEO" ? "Video" : "Image";
  const accessibleLabel = `${label} testimonial from ${testimonial.displayName}: ${testimonial.title}`;

  if (!source || hasFailed) {
    return (
      <div className="testimonial-media-fallback" role="status">
        <p className="muted">{label} unavailable right now.</p>
        {source ? (
          <Button
            className="button-link"
            type="button"
            aria-label={`Retry loading ${label.toLowerCase()} for ${testimonial.title}`}
            onClick={() => {
              setHasFailed(false);
              setAttempt((current) => current + 1);
            }}
          >
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  if (testimonial.type === "IMAGE") {
    return (
      <img
        className="testimonial-media"
        src={`${source}${attemptSuffix}`}
        alt={accessibleLabel}
        loading="lazy"
        decoding="async"
        aria-busy={!hasLoaded}
        onLoad={() => setHasLoaded(true)}
        onError={() => setHasFailed(true)}
      />
    );
  }

  return (
    <video
      className="testimonial-media"
      src={`${source}${attemptSuffix}`}
      controls
      playsInline
      preload="metadata"
      aria-label={accessibleLabel}
      aria-busy={!hasLoaded}
      onLoadedData={() => setHasLoaded(true)}
      onError={() => setHasFailed(true)}
    >
      Your browser does not support embedded videos.
    </video>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return "We could not load testimonials right now. Please try again.";
}
