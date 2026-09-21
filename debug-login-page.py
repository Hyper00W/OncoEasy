from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    messages = []
    page.on("console", lambda msg: messages.append(f"{msg.type}: {msg.text}"))
    page.on("pageerror", lambda err: messages.append(f"PAGEERROR: {err}"))
    page.goto("http://localhost:5173/auth/professional", wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    print("URL:", page.url)
    print("H1:", page.locator("h1").all_text_contents())
    print("inputs:", page.locator("input").count())
    body = page.locator("body").text_content()
    print("body text (first 300):", (body or "")[:300])
    print("--- console ---")
    for m in messages[:15]:
        print(m)
    browser.close()
