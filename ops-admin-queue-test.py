import json
import re
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
API = "http://localhost:3000"

# --- Login via API, then inject session storage exactly like the app expects ---
import urllib.request

req = urllib.request.Request(
    f"{API}/api/v1/auth/login",
    data=json.dumps({
        "email": "ops-admin@oncoeasy.local",
        "password": "dev-only-change-me",
    }).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req) as response:
    payload = json.load(response)

print("login ok:", payload.get("success"))
session_data = payload["data"]
print("session keys:", list(session_data.keys()))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    console_messages = []
    page.on("console", lambda msg: console_messages.append(f"{msg.type}: {msg.text}"))
    page.on("pageerror", lambda err: console_messages.append(f"PAGEERROR: {err}"))

    page.goto(BASE, wait_until="domcontentloaded")

    # Inspect how the app persists its session before injecting
    keys = page.evaluate("() => Object.keys({...localStorage, ...sessionStorage})")
    print("storage keys (pre-login):", keys)

    # Do a real UI login so the app builds its own session shape
    page.goto(f"{BASE}/auth/professional", wait_until="networkidle")
    page.fill('input[type="email"]', "ops-admin@oncoeasy.local")
    page.fill('input[type="password"]', "dev-only-change-me")
    page.click('button[type="submit"]')
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)
    print("after login url:", page.url)
    print("after login h1:", page.locator("h1").first.text_content())

    # Navigate to pharmacy and exercise both queues
    page.goto(f"{BASE}/admin/pharmacy", wait_until="networkidle")
    page.wait_for_timeout(1500)
    print("pharmacy url:", page.url)
    headings = page.locator("h2").all_text_contents()
    print("panel headings:", headings)

    for label in ["Order status filter", "Delivery status filter", "Delivery mode filter"]:
        count = page.get_by_label(label).count()
        print(f"{label}: present={count}")

    # Select an order to render the detail pane
    rows = page.locator(".stack-list .list-row-button")
    print("order rows:", rows.count())
    if rows.count() > 0:
        rows.first.click()
        page.wait_for_timeout(800)
        detail = page.locator(".review-detail")
        print("order detail shown:", detail.count() > 0)
        if detail.count() > 0:
            print("order detail text:", re.sub(r"\s+", " ", detail.first.text_content())[:200])

    drows = page.locator("button.list-row-button", has_text="Order")
    print("delivery rows (Order):", drows.count())
    if drows.count() > 0:
        drows.first.click()
        page.wait_for_timeout(800)
        detail = page.locator(".review-detail")
        print("delivery detail shown:", detail.count() > 0)
        if detail.count() > 0:
            print("delivery detail text:", re.sub(r"\s+", " ", detail.first.text_content())[:200])

    errors = [m for m in console_messages if "PAGEERROR" in m or m.startswith("error")]
    print("console errors:", errors if errors else "none")
    page.screenshot(path="ops-admin-queues.png", full_page=True)
    print("screenshot saved: ops-admin-queues.png")
    browser.close()
print("DONE")
sys.exit(0)
