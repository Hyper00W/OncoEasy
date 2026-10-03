import {
  useMemo,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ElementType,
  type PropsWithChildren,
  type ReactNode
} from "react";

import { STAGGER_STEP_MS, useInViewOnce, usePrefersReducedMotion, type RevealVariant } from "./hooks";

/**
 * OncoEasy motion components.
 *
 * Thin wrappers over the hooks in `./hooks` plus the CSS transitions declared
 * in `styles/motion.css`. Nothing animates beyond transform/opacity, and both
 * components collapse to "plain content" under reduced motion.
 */

type RevealProps = PropsWithChildren<
  {
    /** Element to render. Defaults to a layout-neutral `div`. */
    as?: ElementType;
    /** Reveal direction. `fade` keeps the element in place. */
    variant?: RevealVariant;
    /** Delay in ms, usually `index * STAGGER_STEP_MS`. */
    delay?: number;
    className?: string;
    style?: CSSProperties;
  } & // Pass-through attributes (href/onClick/aria/…): `as` is polymorphic, so
  // anchor attributes are the widest set the reveal wrappers actually need
  // (cards become links, sections keep their carousel hover handlers).
  Omit<ComponentPropsWithoutRef<"a">, "className" | "children" | "style">
>;

/**
 * Scroll-reveal wrapper: fades + shifts its children into place the first time
 * they enter the viewport. Renders a semantic tag when the caller wants one,
 * so it can wrap `section`/`article`/`li` without an extra DOM level.
 */
export function Reveal({
  as,
  variant = "up",
  delay = 0,
  className = "",
  children,
  style,
  ...rest
}: RevealProps) {
  const reducedMotion = usePrefersReducedMotion();
  const { ref, inView } = useInViewOnce<HTMLElement>();
  const Component = (as ?? "div") as ElementType;

  const classes = ["reveal", `reveal-${variant}`, inView ? "is-visible" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <Component
      ref={ref}
      className={classes}
      style={
        {
          ...style,
          // Reduced motion: skip the delay so the content appears instantly.
          "--reveal-delay": reducedMotion ? "0ms" : `${delay}ms`
        } as CSSProperties
      }
      {...rest}
    >
      {children}
    </Component>
  );
}

/**
 * Reveals a list of cards/elements in sequence. Each child gets its own
 * observer and an index-scaled delay, which is what makes grids feel composed
 * rather than dumped on screen.
 */
export function RevealList({
  children,
  itemClassName = "",
  step = STAGGER_STEP_MS,
  variant = "up"
}: {
  children: ReactNode;
  itemClassName?: string;
  step?: number;
  variant?: RevealVariant;
}) {
  const items = useMemo(() => (Array.isArray(children) ? children.filter(Boolean) : [children]), [children]);

  return (
    <>
      {items.map((child, index) => (
        <Reveal key={index} as="div" variant={variant} delay={index * step} className={itemClassName}>
          {child}
        </Reveal>
      ))}
    </>
  );
}
