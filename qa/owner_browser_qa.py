import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path("qa/live-browser-current")
OUT.mkdir(parents=True, exist_ok=True)
BASE_URL = "http://localhost:5173"
email = os.environ["QA_OWNER_EMAIL"]
password = os.environ["QA_OWNER_PASSWORD"]
results = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for name, width, height in (("owner-desktop", 1440, 1100), ("owner-mobile", 390, 844)):
        page = browser.new_page(viewport={"width": width, "height": height})
        console_errors, request_errors = [], []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("requestfailed", lambda r: request_errors.append(f"{r.method} {r.url}: {r.failure}"))
        page.goto(f"{BASE_URL}/admin/login", wait_until="domcontentloaded")
        page.get_by_label("Email address").fill(email)
        page.get_by_label("Password").fill(password)
        page.get_by_role("button", name="Sign in to management").click()
        page.wait_for_url(f"{BASE_URL}/admin", timeout=10000)
        page.wait_for_timeout(750)
        results.append({
            "viewport": name,
            "path": page.url,
            "overflow": page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth"),
            "consoleErrors": console_errors,
            "requestErrors": request_errors,
        })
        page.screenshot(path=str(OUT / f"owner-admin-{width}.png"), full_page=True)
        page.close()
    browser.close()

(OUT / "owner-findings.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
