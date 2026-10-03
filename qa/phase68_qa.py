"""Phase 6.8 browser QA: patient pages, back-link consistency, console errors,
horizontal overflow, and responsive checks against real backend data."""

from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
SHOTS = "qa-shots"

console_errors = []
failed_requests = []


def snapshot(page, name, widths=(1440, 1024, 390)):
    for w in widths:
        page.set_viewport_size({"width": w, "height": 900})
        page.wait_for_timeout(250)
        page.screenshot(path=f"{SHOTS}/{name}-{w}.png", full_page=True)


def audit_page(page, path, name, widths=(1440, 1024, 390), require_auth=True):
    page.set_viewport_size({"width": 1440, "height": 900})
    page.goto(f"{BASE}{path}", wait_until="networkidle")
    page.wait_for_timeout(400)
    snapshot(page, name, widths)

    overflow = page.evaluate(
        "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"
    )
    backlink = page.locator(".back-link").first
    backlink_info = None
    if backlink.count() > 0:
        box = backlink.bounding_box()
        heading = page.locator("h1").first
        hbox = heading.bounding_box() if heading.count() > 0 else None
        backlink_info = {
            "back_x": round(box["x"], 1) if box else None,
            "heading_x": round(hbox["x"], 1) if hbox else None,
        }
    body_snippet = page.locator("body").inner_text()[:160].replace("\n", " | ")
    print(f"[{name}] path={path} overflow={overflow} backlink={backlink_info} body={body_snippet!r}")
    return overflow


def main():
    import pathlib

    pathlib.Path(SHOTS).mkdir(exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        page.on(
            "console",
            lambda msg: console_errors.append(f"{msg.type}: {msg.text}") if msg.type == "error" else None,
        )
        page.on(
            "requestfailed",
            lambda req: failed_requests.append(f"{req.url} {req.failure}"),
        )

        # ---------- Public pages (no auth) ----------
        audit_page(page, "/", "home", widths=(1440, 390), require_auth=False)
        audit_page(page, "/pharmacy", "storefront", widths=(1440, 768, 390), require_auth=False)

        # ---------- Patient auth via real OTP flow ----------
        page.goto(f"{BASE}/auth/patient/phone", wait_until="networkidle")
        page.wait_for_timeout(300)
        content = page.content()
        if 'name="phone"' in content or 'id="phone"' in content or "input" in content:
            phone_input = page.locator('input[type="tel"], input[name="phone"], input#phone').first
            if phone_input.count() > 0:
                phone_input.fill("9999000001")
                page.locator("button[type=submit]").first.click()
                page.wait_for_load_state("networkidle")
                page.wait_for_timeout(500)
                page.screenshot(path=f"{SHOTS}/auth-step2.png")

                # OTP screen: dev hint may expose the OTP; try common dev OTP
                otp_inputs = page.locator("input.input.otp-digit, input[autocomplete=one-time-code], .otp-group input")
                if otp_inputs.count() > 0:
                    otp_value = "123456"
                    dev_hint = page.locator(".dev-otp-hint")
                    if dev_hint.count() > 0:
                        text = dev_hint.inner_text()
                        digits = "".join(ch for ch in text if ch.isdigit())
                        if len(digits) >= 6:
                            otp_value = digits[:6]
                    for i in range(otp_inputs.count()):
                        otp_inputs.nth(i).fill(otp_value[i] if i < len(otp_value) else "0")
                    page.locator("button[type=submit]").first.click()
                    page.wait_for_load_state("networkidle")
                    page.wait_for_timeout(600)
                    page.screenshot(path=f"{SHOTS}/after-otp.png", full_page=True)

        print("URL after auth attempt:", page.url)
        body = page.locator("body").inner_text()[:200].replace("\n", " | ")
        print("after-auth body:", body)

        # If we landed on onboarding, complete minimal profile to reach dashboard
        if "/onboarding" in page.url:
            page.screenshot(path=f"{SHOTS}/onboarding.png", full_page=True)
            # Try to fill any visible required inputs
            inputs = page.locator("main input.input:visible")
            for i in range(min(inputs.count(), 8)):
                try:
                    inputs.nth(i).fill("QA Test")
                except Exception:
                    pass
            selects = page.locator("main select.input:visible")
            for i in range(selects.count()):
                try:
                    selects.nth(i).select_option(index=1)
                except Exception:
                    pass
            next_btn = page.locator("button[type=submit], .onboarding-actions .button").last
            for _ in range(4):
                try:
                    if next_btn.is_visible():
                        next_btn.click()
                        page.wait_for_timeout(500)
                except Exception:
                    break
            page.wait_for_load_state("networkidle")
            print("URL after onboarding attempt:", page.url)

        # ---------- Patient workspace pages ----------
        patient_paths = [
            ("/patient", "dashboard"),
            ("/patient/pharmacy?tab=cart", "pharmacy-cart"),
            ("/patient/pharmacy?tab=prescriptions", "pharmacy-rx"),
            ("/patient/pharmacy?tab=orders", "pharmacy-orders"),
            ("/patient/consultations", "consultations"),
            ("/patient/labs", "labs"),
            ("/patient/pap", "pap"),
            ("/patient/journey", "journey"),
            ("/patient/knowledge", "knowledge"),
            ("/patient/trials", "trials"),
            ("/patient/stories", "stories"),
            ("/patient/chat", "chat"),
            ("/patient/referral", "referral"),
            ("/patient/testimonials", "testimonials"),
        ]
        for path, name in patient_paths:
            try:
                audit_page(page, path, name)
            except Exception as exc:
                print(f"[{name}] ERROR: {exc}")

        context.close()
        browser.close()

    print("\n=== CONSOLE ERRORS ===")
    for err in console_errors[:30]:
        print(" ", err)
    if not console_errors:
        print("  none")
    print("=== FAILED REQUESTS ===")
    for err in failed_requests[:30]:
        print(" ", err)
    if not failed_requests:
        print("  none")


if __name__ == "__main__":
    main()
