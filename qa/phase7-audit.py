"""Phase 7 design audit.

Programmatic checks that stand in for eyeballing screenshots:
  - effective text contrast for key selectors (WCAG AA 4.5:1 body / 3:1 large)
  - card-height consistency inside grids
  - touch target sizes at 390px, after the mobile fix
  - sticky header overlap with anchored content
"""

import json

from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:5173"
PAGES = ["/", "/pharmacy", "/auth", "/admin/login"]

CONTRAST_JS = """
() => {
  const lum = ([r, g, b]) => {
    const f = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (value) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(value || '');
    if (!m) return null;
    const parts = m[1].split(',').map((n) => parseFloat(n));
    return { rgb: [parts[0], parts[1], parts[2]], a: parts.length > 3 ? parts[3] : 1 };
  };
  const bgOf = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.6) return bg.rgb;
      node = node.parentElement;
    }
    return [250, 252, 253];
  };
  const ratio = (fg, bg) => {
    const a = lum(fg) + 0.05;
    const b = lum(bg) + 0.05;
    return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
  };

  const selectors = ['h1', 'h2', 'h3', 'p', 'a', '.muted', '.field-hint', '.eyebrow', '.results-count', '.product-price', '.footer-links a', '.footer-bottom span', '.site-nav-link'];
  const out = [];
  for (const selector of selectors) {
    for (const el of [...document.querySelectorAll(selector)].slice(0, 6)) {
      if (!el.textContent || !el.textContent.trim()) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) < 0.5) continue;
      const fg = parse(style.color);
      if (!fg) continue;
      const bg = bgOf(el);
      const size = parseFloat(style.fontSize);
      const bold = parseInt(style.fontWeight, 10) >= 600;
      const large = size >= 24 || (size >= 18.66 && bold);
      const needed = large ? 3 : 4.5;
      const value = ratio(fg.rgb, bg);
      out.push({ selector, sample: el.textContent.trim().slice(0, 32), size, ratio: value, needed, pass: value >= needed });
    }
  }
  return out;
}
"""

GRIDS_JS = """
() => {
  const selectors = ['.product-grid', '.care-quick-grid', '.metric-grid', '.catalog-category-grid', '.trust-strip', '.queue-count-grid'];
  const out = [];
  for (const selector of selectors) {
    const grid = document.querySelector(selector);
    if (!grid) continue;
    const children = [...grid.children].map((c) => Math.round(c.getBoundingClientRect().height)).filter((h) => h > 0);
    if (children.length < 2) continue;
    out.push({
      selector,
      count: children.length,
      min: Math.min(...children),
      max: Math.max(...children),
      spread: Math.max(...children) - Math.min(...children)
    });
  }
  return out;
}
"""

TARGETS_JS = """
() => {
  const small = [];
  for (const el of document.querySelectorAll('a, button, input, select, textarea')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden') continue;
    if (rect.height < 24 || rect.width < 24) {
      small.push({
        text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30),
        cls: typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : '',
        w: Math.round(rect.width), h: Math.round(rect.height)
      });
    }
  }
  return small;
}
"""

report = {"contrast": {}, "grids": {}, "targets_390": {}, "sticky": {}}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    for route in PAGES:
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.goto(f"{BASE_URL}{route}", wait_until="domcontentloaded")
        try:
            page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            page.wait_for_timeout(800)
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(900)
        report["contrast"][route] = [entry for entry in page.evaluate(CONTRAST_JS) if not entry["pass"]]
        report["grids"][route] = page.evaluate(GRIDS_JS)
        report["sticky"][route] = page.evaluate(
            """() => {
                const header = document.querySelector('.site-header');
                const anchor = document.querySelector('.storefront-filters, .patient-shell-body > *');
                return {
                  headerZ: header ? getComputedStyle(header).zIndex : null,
                  headerHeight: header ? Math.round(header.getBoundingClientRect().height) : null,
                  scrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop
                };
            }"""
        )
        page.close()

    for route in ["/", "/pharmacy"]:
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.goto(f"{BASE_URL}{route}", wait_until="domcontentloaded")
        try:
            page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            page.wait_for_timeout(900)
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(900)
        report["targets_390"][route] = page.evaluate(TARGETS_JS)
        page.close()

    browser.close()

print(json.dumps(report, indent=2))
