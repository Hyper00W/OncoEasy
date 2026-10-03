"""Phase 7 authenticated route QA.

Signs in through the real patient OTP flow (the backend echoes a test OTP in
dev/test mode, which the UI surfaces), then sweeps every patient route at
desktop and mobile widths looking for horizontal overflow, console errors,
failed requests and unreachable routes.
"""

import json
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:5173"
OUT = Path("qa/phase7-current")
OUT.mkdir(parents=True, exist_ok=True)
PHONE = "+15550000111"

ROUTES = [
    "patient",
    "patient/journey",
    "patient/labs",
    "patient/pap",
    "patient/knowledge",
    "patient/trials",
    "patient/stories",
    "patient/testimonials",
    "patient/chat",
    "patient/consultations",
    "patient/referral",
    "patient/pharmacy?tab=cart",
    "patient/pharmacy?tab=orders",
    "patient/pharmacy?tab=prescriptions",
]

VIEWPORTS = [("desktop", 1440, 1000), ("tablet", 768, 900), ("mobile", 390, 844), ("mobile-narrow", 360, 800)]

findings = []


def settle(page):
    try:
        page.wait_for_load_state("networkidle", timeout=9000)
    except Exception:
        page.wait_for_timeout(900)


def sign_in(page):
    page.goto(f"{BASE_URL}/auth/patient/phone", wait_until="domcontentloaded")
    settle(page)
    page.get_by_label("Phone number").fill(PHONE)
    page.get_by_role("button", name="Send code").click()
    page.wait_for_url(f"{BASE_URL}/auth/patient/otp", timeout=15000)
    otp = page.evaluate("() => sessionStorage.getItem('oncoeasy:pending-dev-otp:v1')")
    hint = page.locator("[data-dev-otp]").first
    if not otp and hint.count():
        text = hint.inner_text()
        otp = "".join(ch for ch in text if ch.isdigit())[-4:]
    if not otp or len(otp) != 4:
        raise RuntimeError(f"no usable dev OTP (session={otp!r})")
    for index, digit in enumerate(otp):
        page.get_by_label(f"Digit {index + 1} of 4").fill(digit)
    page.get_by_role("button", name="Verify and continue").click()
    page.wait_for_timeout(2500)
    return page.evaluate("() => location.pathname + location.search")


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()

    landing = sign_in(page)
    findings.append({"check": "sign-in", "landedOn": landing})
    page.screenshot(path=str(OUT / "auth-landing.png"), full_page=True)

    context.close()

    for viewport_name, width, height in VIEWPORTS:
        context = browser.new_context(viewport={"width": width, "height": height})
        page = context.new_page()
        console_errors, request_errors = [], []
        page.on(
            "console",
            lambda message: console_errors.append(message.text) if message.type == "error" else None,
        )
        page.on(
            "requestfailed",
            lambda request: request_errors.append(f"{request.method} {request.url}: {request.failure}"),
        )
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
                  const stuck = [...document.querySelectorAll('.reveal')].filter(
                    (el) => !el.classList.contains('is-visible') && el.getBoundingClientRect().top < window.innerHeight
                  );
                  return {
                    path: location.pathname + location.search,
                    scrollWidth: doc.scrollWidth,
                    clientWidth: doc.clientWidth,
                    overflow,
                    revealTotal: document.querySelectorAll('.reveal').length,
                    revealStuck: stuck.length,
                    hasCareCenter: !!document.querySelector('.care-center'),
                    hasTimeline: !!document.querySelector('.care-timeline'),
                    brokenImages: [...document.images]
                      .filter((image) => image.complete && image.naturalWidth === 0)
                      .map((image) => image.currentSrc || image.src)
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
            if route in {"patient", "patient/journey", "patient/labs", "patient/knowledge", "patient/pap"} and viewport_name in {
                "desktop",
                "mobile",
            }:
                page.screenshot(path=str(OUT / f"{route.replace('/', '-').replace('?', '-')}-{width}.png"), full_page=True)
        context.close()

    browser.close()

(OUT / "auth-findings.json").write_text(json.dumps(findings, indent=2), encoding="utf-8")

problems = [
    f
    for f in findings
    if f.get("route")
    and (
        f.get("scrollWidth", 0) > f.get("clientWidth", 0)
        or f.get("consoleErrors")
        or f.get("requestErrors")
        or f.get("revealStuck")
    )
]
print(json.dumps({"checked": len(findings), "problems": len(problems)}, indent=2))
for entry in findings:
    if entry.get("check") == "sign-in":
        print("signed in ->", entry["landedOn"])
for entry in problems:
    print(json.dumps({k: entry[k] for k in ("viewport", "route", "overflow", "consoleErrors", "requestErrors", "revealStuck")}, indent=2))
