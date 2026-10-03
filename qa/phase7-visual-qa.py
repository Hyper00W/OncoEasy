"""Phase 7 frontend redesign QA.

Checks the public surfaces that need no credentials (home + storefront) at the
widths that matter, records overflow / console / request failures, captures
screenshots, verifies the mobile navigation drawer, and measures the two brand
lockups so the navy admin sidebar uses the correct one.
"""

import json
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:5173"
OUT = Path("qa/phase7-current")
OUT.mkdir(parents=True, exist_ok=True)

VIEWPORTS = {
    "1440": (1440, 1000),
    "1280": (1280, 900),
    "1024": (1024, 900),
    "768": (768, 900),
    "430": (430, 860),
    "390": (390, 844),
    "360": (360, 800),
}

ROUTES = {
    "home": "/",
    "pharmacy": "/pharmacy",
    "pharmacy-rx": "/pharmacy?prescriptionRequired=true",
    "auth": "/auth",
}

findings = []


def settle(page):
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        page.wait_for_timeout(800)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # ---- Brand lockup brightness check (decides the navy sidebar logo) ----
    probe = browser.new_page()
    probe.goto(f"{BASE_URL}/", wait_until="commit")
    logos = probe.evaluate(
        """async () => {
            const files = [
              '/assets/branding/oncoeasy-logo.png',
              '/assets/branding/oncoeasy-logo-dark.png',
              '/assets/branding/oncoeasy-logo-light.png'
            ];
            const out = [];
            for (const file of files) {
              const image = new Image();
              image.src = file;
              await image.decode().catch(() => undefined);
              if (!image.naturalWidth) { out.push({ file, error: 'could not load' }); continue; }
              const canvas = document.createElement('canvas');
              canvas.width = image.naturalWidth;
              canvas.height = image.naturalHeight;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(image, 0, 0);
              const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
              let opaque = 0, luminance = 0;
              for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] < 32) continue;
                opaque += 1;
                luminance += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
              }
              out.push({ file, opaquePixels: opaque, avgLuminance: opaque ? Math.round(luminance / opaque) : null });
            }
            return out;
        }"""
    )
    findings.append({"check": "brand-lockup-luminance", "logos": logos})
    probe.close()

    # ---- Route sweep ----
    for viewport_name, (width, height) in VIEWPORTS.items():
        page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
        console_errors = []
        request_errors = []
        page.on(
            "console",
            lambda message: console_errors.append(message.text) if message.type == "error" else None,
        )
        page.on(
            "requestfailed",
            lambda request: request_errors.append(f"{request.method} {request.url}: {request.failure}"),
        )

        for name, route in ROUTES.items():
            console_errors.clear()
            request_errors.clear()
            response = page.goto(f"{BASE_URL}{route}", wait_until="domcontentloaded")
            settle(page)
            data = page.evaluate(
                """() => {
                  const doc = document.documentElement;
                  const overflowing = [];
                  for (const el of document.querySelectorAll('body *')) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) continue;
                    if (rect.right > doc.clientWidth + 2 || rect.left < -2) {
                      overflowing.push({
                        sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''),
                        left: Math.round(rect.left),
                        right: Math.round(rect.right)
                      });
                      if (overflowing.length >= 8) break;
                    }
                  }
                  return {
                    path: location.pathname + location.search,
                    scrollWidth: doc.scrollWidth,
                    clientWidth: doc.clientWidth,
                    overflowing,
                    imageFailures: [...document.images]
                      .filter((image) => !image.complete || image.naturalWidth === 0)
                      .map((image) => image.currentSrc || image.src),
                    heroVisible: !!document.querySelector('.hero-section, .page-hero'),
                    revealCount: document.querySelectorAll('.reveal').length,
                    revealStuck: [...document.querySelectorAll('.reveal')].filter(
                      (el) => !el.classList.contains('is-visible') && el.getBoundingClientRect().top < window.innerHeight
                    ).length
                  };
                }"""
            )
            entry = {
                "viewport": viewport_name,
                "route": name,
                "http": response.status if response else None,
                **data,
                "consoleErrors": list(console_errors),
                "requestErrors": list(request_errors),
            }
            findings.append(entry)
            if name in {"home", "pharmacy"} and viewport_name in {"1440", "768", "390"}:
                page.screenshot(path=str(OUT / f"{name}-{width}.png"), full_page=True)

        # Mobile navigation drawer at the smallest widths.
        if viewport_name in {"360", "390"}:
            page.goto(f"{BASE_URL}/", wait_until="domcontentloaded")
            settle(page)
            page.get_by_role("button", name="Open navigation menu").click()
            page.wait_for_selector('[role="dialog"][aria-modal="true"]')
            page.wait_for_timeout(400)
            drawer = page.evaluate(
                """() => ({
                  dialog: !!document.querySelector('[role="dialog"][aria-modal="true"]'),
                  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                  drawerWidth: Math.round(document.querySelector('[role="dialog"]').getBoundingClientRect().width)
                })"""
            )
            findings.append({"viewport": viewport_name, "route": "home-drawer", **drawer})
            page.screenshot(path=str(OUT / f"home-drawer-{width}.png"))
        page.close()

    browser.close()

(OUT / "findings.json").write_text(json.dumps(findings, indent=2), encoding="utf-8")

overflow = [f for f in findings if f.get("overflow") is not True and f.get("scrollWidth", 0) > f.get("clientWidth", 0)]
errors = [f for f in findings if f.get("consoleErrors") or f.get("requestErrors")]
print(json.dumps({"total": len(findings), "overflowing": len(overflow), "withErrors": len(errors)}, indent=2))
for entry in findings:
    if entry.get("check") == "brand-lockup-luminance":
        print("LOGOS:", json.dumps(entry["logos"]))
