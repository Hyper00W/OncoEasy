import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * OncoEasy motion hooks.
 *
 * Kept separate from `motion.tsx` so that file only exports components (Vite's
 * fast-refresh boundary) while these hooks stay independently testable.
 *
 * Everything here degrades to "instantly visible": when the visitor prefers
 * reduced motion, or IntersectionObserver is missing, nothing waits, nothing
 * animates, and content renders immediately.
 */

export type RevealVariant = "up" | "down" | "left" | "right" | "scale" | "fade";

/** Shared stagger step so sibling reveals never animate in lockstep. */
export const STAGGER_STEP_MS = 70;

/**
 * True when the visitor asked the OS for reduced motion. Read from JS as well
 * as CSS so entrance delays can be skipped outright rather than transitioning
 * in 0.01ms.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return reduced;
}

/**
 * Fires once, the first time the element scrolls into view. Without
 * IntersectionObserver the element starts (and stays) visible, so content is
 * never trapped behind a missing browser API.
 */
export function useInViewOnce<T extends HTMLElement = HTMLElement>(
  /** How much of the element must be visible before revealing (0–1). */
  threshold = 0.15,
  /** Extra room around the viewport so reveals start just before entry. */
  rootMargin = "0px 0px -8% 0px"
): { ref: RefObject<T | null>; inView: boolean } {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (inView) return;
    const node = ref.current;
    if (!node) return;

    let observer: IntersectionObserver | null = null;
    // Set on the observer's FIRST callback, intersecting or not. If no
    // callback ever arrives the observer is effectively dead (occluded or
    // embedded webviews can silently pause IntersectionObserver) and the
    // fallback poll below takes over.
    let observerAlive = false;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          observerAlive = true;
          if (entries.some((entry) => entry.isIntersecting)) {
            setInView(true);
            observer?.disconnect();
          }
        },
        { threshold, rootMargin }
      );

      observer.observe(node);
    }

    // Fallback poll, armed only when the observer has stayed silent for 3s:
    // reveal elements once they enter the viewport band (mirrors the -8%
    // bottom rootMargin). In healthy browsers the observer's initial callback
    // marks it alive and this poll never starts.
    let poll: number | undefined;
    const armFallback = window.setTimeout(() => {
      if (observerAlive || inView) return;
      const check = () => {
        const rect = node.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) {
          setInView(true);
        }
      };
      check();
      poll = window.setInterval(check, 600);
    }, 3000);

    return () => {
      observer?.disconnect();
      window.clearTimeout(armFallback);
      if (poll !== undefined) window.clearInterval(poll);
    };
  }, [inView, rootMargin, threshold]);

  return { ref, inView };
}

/**
 * Counts up to `value` once the host element is visible. Purely a
 * presentational flourish for numeric metrics — the exact value is always the
 * final frame, and reduced motion jumps straight to it.
 */
export function useCountUp(
  value: number,
  durationMs = 900
): { ref: RefObject<HTMLElement | null>; display: string } {
  const reducedMotion = usePrefersReducedMotion();
  const { ref, inView } = useInViewOnce<HTMLElement>(0.4);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!inView || reducedMotion) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min((now - start) / durationMs, 1);
      // easeOutCubic: lively at the start, settled at the end.
      setProgress(1 - Math.pow(1 - elapsed, 3));
      if (elapsed < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationMs, inView, reducedMotion]);

  const shown = reducedMotion || !inView ? value : value * progress;
  return { ref, display: formatCount(shown) };
}

function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString();
}
