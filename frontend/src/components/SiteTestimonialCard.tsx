import { useState } from "react";

import {
  testimonialMediaUrl,
  type PublicTestimonial
} from "../testimonials/testimonials-api";

type MediaState = "loading" | "ready" | "failed";

/**
 * Public testimonial card backed by GET /api/v1/testimonials. Media uses the
 * backend delivery path when available, with a graceful fallback when media is
 * missing or fails to load. Nothing is hardcoded.
 */
export function SiteTestimonialCard({ testimonial }: { testimonial: PublicTestimonial }) {
  return (
    <article className="site-testimonial-card">
      {testimonial.media ? <SiteTestimonialMedia testimonial={testimonial} /> : null}
      <h3>{testimonial.title}</h3>
      {testimonial.description ? <blockquote>{testimonial.description}</blockquote> : null}
      <p className="site-testimonial-name">
        {testimonial.displayName}
        {testimonial.type === "VIDEO" ? " · video story" : ""}
      </p>
    </article>
  );
}

function SiteTestimonialMedia({ testimonial }: { testimonial: PublicTestimonial }) {
  const [state, setState] = useState<MediaState>("loading");
  const [attempt, setAttempt] = useState(0);

  const deliveryUrl = testimonialMediaUrl(testimonial.media?.deliveryUrl);
  const source = deliveryUrl ?? testimonial.media?.access?.reference ?? null;
  const attemptSuffix = attempt > 0 ? `${source?.includes("?") ? "&" : "?"}retry=${attempt}` : "";
  const isVideo = testimonial.type === "VIDEO";

  // Re-render with a fresh key on retry so the media element remounts and its
  // load/error events fire again; no effect-driven setState is needed.
  const mediaKey = `${source ?? "none"}-${attempt}`;

  if (!source || state === "failed") {
    return (
      <div className="site-testimonial-media">
        <div className="site-testimonial-media-fallback" role="status">
          <p className="muted">
            {isVideo ? "Video" : "Photo"} unavailable right now.
            {source ? (
              <>
                {" "}
                <button
                  className="link-button"
                  type="button"
                  onClick={() => {
                    setAttempt((current) => current + 1);
                    setState("loading");
                  }}
                >
                  Retry
                </button>
              </>
            ) : null}
          </p>
        </div>
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className="site-testimonial-media">
        <video
          key={mediaKey}
          src={`${source}${attemptSuffix}`}
          controls
          playsInline
          preload="metadata"
          aria-label={`Video testimonial from ${testimonial.displayName}: ${testimonial.title}`}
          onLoadedData={() => setState("ready")}
          onError={() => setState("failed")}
        />
      </div>
    );
  }

  return (
    <div className="site-testimonial-media">
      <img
        key={mediaKey}
        src={`${source}${attemptSuffix}`}
        alt={`Photo testimonial from ${testimonial.displayName}: ${testimonial.title}`}
        loading="lazy"
        decoding="async"
        onLoad={() => setState("ready")}
        onError={() => setState("failed")}
      />
    </div>
  );
}
