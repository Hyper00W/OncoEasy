import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:5173"
OUT = Path("qa/live-browser-current")
OUT.mkdir(parents=True, exist_ok=True)

ROUTES = {
    "home": "/",
    "pharmacy": "/pharmacy",
    "product-detail": "/pharmacy/products/not-a-real-product",
    "cart": "/patient/pharmacy?tab=cart",
    "dashboard": "/patient",
    "consultation": "/patient/consultations",
    "labs": "/patient/labs",
    "pap": "/patient/pap",
    "journey": "/patient/journey",
    "knowledge": "/patient/knowledge",
    "trials": "/patient/trials",
    "stories": "/patient/stories",
    "testimonials": "/patient/testimonials",
    "chat": "/patient/chat",
    "doctor": "/doctor",
    "pharmacist": "/pharmacist",
    "admin": "/admin",
}

VIEWPORTS = {"desktop": (1440, 1100), "tablet": (1024, 1000), "mobile": (390, 844), "mobile-narrow": (360, 800)}
REPRESENTATIVE = {"home", "pharmacy", "product-detail", "cart", "dashboard", "doctor", "pharmacist", "admin"}

def settle(page):
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        page.wait_for_timeout(700)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    findings = []
    for viewport_name, (width, height) in VIEWPORTS.items():
        page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
        console_errors = []
        request_errors = []
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("requestfailed", lambda request: request_errors.append(f"{request.method} {request.url}: {request.failure}"))
        for name, route in ROUTES.items():
            console_errors.clear()
            request_errors.clear()
            response = page.goto(f"{BASE_URL}{route}", wait_until="domcontentloaded")
            settle(page)
            data = page.evaluate("""() => ({
              path: location.pathname + location.search,
              title: document.title,
              scrollWidth: document.documentElement.scrollWidth,
              clientWidth: document.documentElement.clientWidth,
              imageFailures: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.currentSrc || image.src),
              dialogs: document.querySelectorAll('[role="dialog"][aria-modal="true"]').length,
              focusables: [...document.querySelectorAll('button,a,input,select,textarea')].filter((el) => !el.matches(':disabled')).length
            })""")
            findings.append({
                "viewport": viewport_name,
                "route": name,
                "http": response.status if response else None,
                "path": data["path"],
                "overflow": data["scrollWidth"] > data["clientWidth"],
                "imageFailures": data["imageFailures"],
                "consoleErrors": console_errors,
                "requestErrors": request_errors,
                "dialogs": data["dialogs"],
                "focusables": data["focusables"],
            })
            if name in REPRESENTATIVE and viewport_name in {"desktop", "mobile"}:
                page.screenshot(path=str(OUT / f"{name}-{width}.png"), full_page=True)
        # Test the actual public navigation drawer at both representative mobile widths.
        if viewport_name in {"mobile", "mobile-narrow"}:
            page.goto(f"{BASE_URL}/", wait_until="domcontentloaded")
            settle(page)
            page.get_by_role("button", name="Open navigation menu").click()
            page.wait_for_selector('[role="dialog"][aria-modal="true"]')
            drawer = page.evaluate("() => ({ dialog: !!document.querySelector('[role=\"dialog\"][aria-modal=\"true\"]'), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth })")
            findings.append({"viewport": viewport_name, "route": "home-mobile-drawer", **drawer})
            page.screenshot(path=str(OUT / f"home-drawer-{width}.png"), full_page=True)
        page.close()

    owner_email = os.environ.get("QA_OWNER_EMAIL")
    owner_password = os.environ.get("QA_OWNER_PASSWORD")
    if owner_email and owner_password:
        for viewport_name, (width, height) in {"owner-desktop": (1440, 1100), "owner-mobile": (390, 844)}.items():
            page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
            console_errors = []
            request_errors = []
            page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
            page.on("requestfailed", lambda request: request_errors.append(f"{request.method} {request.url}: {request.failure}"))
            page.goto(f"{BASE_URL}/admin/login", wait_until="domcontentloaded")
            settle(page)
            page.get_by_label("Email address").fill(owner_email)
            page.get_by_label("Password").fill(owner_password)
            page.get_by_role("button", name="Sign in to management").click()
            page.wait_for_url(f"{BASE_URL}/admin", timeout=10000)
            settle(page)
            data = page.evaluate("""() => ({
              path: location.pathname,
              overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
              dialogs: document.querySelectorAll('[role="dialog"][aria-modal="true"]').length
            })""")
            findings.append({"viewport": viewport_name, "route": "owner-admin", **data, "consoleErrors": console_errors, "requestErrors": request_errors})
            page.screenshot(path=str(OUT / f"owner-admin-{width}.png"), full_page=True)
            page.close()
    (OUT / "findings.json").write_text(__import__("json").dumps(findings, indent=2), encoding="utf-8")
    browser.close()
