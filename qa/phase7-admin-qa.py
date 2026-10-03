"""Phase 7 management console QA.

Signs in through the real management login with the development seed OWNER (and
falls back to OPS_ADMIN), then sweeps every management route at desktop and
mobile widths.
"""

import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:5173"
OUT = Path("qa/phase7-current")
OUT.mkdir(parents=True, exist_ok=True)

CANDIDATES = [
    (os.environ.get("QA_OWNER_EMAIL", "owner@oncoeasy.local"), os.environ.get("QA_OWNER_PASSWORD", "dev-only-owner-change-me")),
    (os.environ.get("QA_ADMIN_EMAIL", "ops-admin@oncoeasy.local"), os.environ.get("QA_ADMIN_PASSWORD", "dev-only-change-me")),
]

ROUTES = [
    "admin",
    "admin/pharmacy",
    "admin/referrals",
    "admin/consultations",
    "admin/labs",
    "admin/pap",
    "admin/journey",
    "admin/knowledge",
    "admin/trials",
    "admin/stories",
    "admin/testimonials",
    "admin/chat",
    "admin/analytics",
    "admin/forecasts",
]

findings = []


def settle(page):
    try:
        page.wait_for_load_state("networkidle", timeout=9000)
    except Exception:
        page.wait_for_timeout(900)


def sign_in(page):
    page.goto(f"{BASE_URL}/admin/login", wait_until="domcontentloaded")
    settle(page)
    for email, password in CANDIDATES:
        page.get_by_label("Work email").fill(email)
        page.get_by_label("Password").fill(password)
        page.get_by_role("button", name="Sign in", exact=True).click()
        page.wait_for_timeout(2500)
        if page.url.rstrip("/").endswith("/admin"):
            return email
        page.reload(wait_until="domcontentloaded")
        settle(page)
    raise RuntimeError("management sign-in failed for all candidates")


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    probe = browser.new_context(viewport={"width": 1440, "height": 1000})
    probe_page = probe.new_page()
    acting = sign_in(probe_page)
    findings.append({"check": "management-sign-in", "as": acting, "userRole": probe_page.evaluate("() => JSON.parse(localStorage.getItem('oncoeasy:session:v1') || '{}')?.user?.role ?? null")})
    probe.close()

    for viewport_name, width, height in (("desktop", 1440, 1000), ("tablet", 1024, 900), ("mobile", 390, 844)):
        context = browser.new_context(viewport={"width": width, "height": height})
        page = context.new_page()
        console_errors, request_errors = [], []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("requestfailed", lambda r: request_errors.append(f"{r.method} {r.url}: {r.failure}"))
        sign_in(page)

        for route in ROUTES:
            console_errors.clear()
            request_errors.clear()
            page.goto(f"{BASE_URL}/{route}", wait_until="domcontentloaded")
            settle(page)
            page.wait_for_timeout(350)
            data = page.evaluate(
                """() => {
                  const doc = document.documentElement;
                  const overflow = [];
                  for (const el of document.querySelectorAll('body *')) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) continue;
                    if (rect.right > doc.clientWidth + 2 || rect.left < -2) {
                      overflow.push({
                        sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ').slice(0,2).join('.') : ''),
                        right: Math.round(rect.right)
                      });
                      if (overflow.length >= 6) break;
                    }
                  }
                  return {
                    path: location.pathname,
                    scrollWidth: doc.scrollWidth,
                    clientWidth: doc.clientWidth,
                    overflow,
                    sidebarVisible: !!document.querySelector('.admin-sidebar') && getComputedStyle(document.querySelector('.admin-sidebar')).display !== 'none',
                    sidebarBg: (() => { const s = document.querySelector('.admin-sidebar'); return s ? getComputedStyle(s).backgroundImage.slice(0, 60) : null; })(),
                    navLinks: document.querySelectorAll('.admin-nav-link').length,
                    tables: document.querySelectorAll('.admin-table').length,
                    skeletonlessQueue: document.querySelectorAll('.skeleton-queue-card').length,
                    overviewGrid: getComputedStyle(document.querySelector('.admin-overview-grid') || document.body).display
                  };
                }"""
            )
            findings.append(
                {
                    "viewport": viewport_name,
                    "route": route,
                    **data,
                    "consoleErrors": list(console_errors),
                    "requestErrors": list(request_errors),
                }
            )
            if route in {"admin", "admin/pharmacy"} and viewport_name in {"desktop", "mobile"}:
                page.screenshot(path=str(OUT / f"{route.replace('/', '-')}-{width}.png"), full_page=True)
        context.close()

    browser.close()

(OUT / "admin-findings.json").write_text(json.dumps(findings, indent=2), encoding="utf-8")
problems = [f for f in findings if f.get("route") and (f.get("scrollWidth", 0) > f.get("clientWidth", 0) or f.get("consoleErrors") or f.get("requestErrors"))]
print(json.dumps({"checked": len(findings), "problems": len(problems)}, indent=2))
for entry in findings:
    if entry.get("check"):
        print(entry)
for entry in problems:
    print(json.dumps({k: entry.get(k) for k in ("viewport", "route", "overflow", "consoleErrors", "requestErrors")}, indent=2))
