import type { AnchorHTMLAttributes, MouseEvent, PropsWithChildren } from "react";

type SiteLinkProps = PropsWithChildren<
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    href: string;
    replace?: boolean;
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  }
>;

export function SiteLink({ href, replace = false, children, onClick, ...rest }: SiteLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>): void {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (replace) {
      window.history.replaceState({}, "", href);
    } else {
      window.history.pushState({}, "", href);
    }
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}

/**
 * Imperative client-side navigation for non-link controls (buttons, tab bars).
 * Pushes the path and reuses the router's existing popstate listener, so
 * AppRouter stays the single navigation authority.
 *
 * Exported via an export-alias so the react-refresh lint rule sees a plain
 * export rather than a second component-shaped declaration.
 */
function navigateToImpl(path: string): void {
  if (window.location.pathname + window.location.search === path) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// eslint-disable-next-line react-refresh/only-export-components
export { navigateToImpl as navigateTo };
