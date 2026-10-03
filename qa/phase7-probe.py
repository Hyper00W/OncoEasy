"""Phase 7 probes: confirm the new layers are live, find broken images, and
audit mobile touch targets / contrast / sticky overlap programmatically."""

import json

from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:5173"
report = {}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.goto(f"{BASE_URL}/", wait_until="domcontentloaded")
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        page.wait_for_timeout(800)

    report["layersLive"] = page.evaluate(
        """() => {
            const hero = document.querySelector('.hero-section');
            const navLink = document.querySelector('.site-nav-link');
            const after = navLink ? getComputedStyle(navLink, '::after') : null;
            const root = getComputedStyle(document.documentElement);
            return {
              newSheets: [...document.styleSheets].map((s) => (s.href || '').split('/').pop()).filter(Boolean),
              heroIsolation: hero ? getComputedStyle(hero).isolation : null,
              heroHasAmbientPseudo: hero ? getComputedStyle(hero, '::after').animationName : null,
              navIndicator: after ? { content: after.content, bg: after.backgroundColor } : null,
              motionTokens: {
                ease: root.getPropertyValue('--motion-ease-out').trim(),
                reveal: root.getPropertyValue('--motion-reveal').trim()
              }
            };
        }"""
    )

    report["brokenImages"] = page.evaluate(
        """() => [...document.images]
            .filter((image) => !image.complete || image.naturalWidth === 0)
            .map((image) => ({ src: image.currentSrc || image.src, alt: image.alt }))"""
    )

    report["consoleOnHome"] = []
    report["sections"] = page.evaluate(
        """() => [...document.querySelectorAll('.site-main > *')].map((el) => ({
            tag: el.tagName.toLowerCase(),
            cls: typeof el.className === 'string' ? el.className.split(' ')[0] : '',
            height: Math.round(el.getBoundingClientRect().height)
        }))"""
    )
    page.close()

    # Mobile: touch targets + contrast of key text.
    mobile = browser.new_page(viewport={"width": 390, "height": 844})
    mobile.goto(f"{BASE_URL}/", wait_until="domcontentloaded")
    try:
        mobile.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        mobile.wait_for_timeout(800)

    report["mobile"] = mobile.evaluate(
        """() => {
            const small = [];
            for (const el of document.querySelectorAll('a, button, input, select, textarea')) {
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) continue;
              if (rect.height < 40 || rect.width < 40) {
                small.push({
                  text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 34),
                  cls: typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : '',
                  w: Math.round(rect.width), h: Math.round(rect.height)
                });
              }
            }
            const measure = (sel) => {
              const el = document.querySelector(sel);
              if (!el) return null;
              const style = getComputedStyle(el);
              return { color: style.color, fontSize: style.fontSize, lineHeight: style.lineHeight };
            };
            return {
              undersizedTargets: small.slice(0, 20),
              undersizedCount: small.length,
              heading: measure('h1'),
              body: measure('p'),
              muted: measure('.muted, .page-hero-description, .hero-copy p')
            };
        }"""
    )

    # Drawer touch targets.
    mobile.get_by_role("button", name="Open navigation menu").click()
    mobile.wait_for_selector('[role="dialog"][aria-modal="true"]')
    mobile.wait_for_timeout(450)
    report["drawer"] = mobile.evaluate(
        """() => {
            const small = [];
            for (const el of document.querySelectorAll('[role="dialog"] a, [role="dialog"] button')) {
              const rect = el.getBoundingClientRect();
              if (rect.height < 40) {
                small.push({ text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), h: Math.round(rect.height) });
              }
            }
            const dialog = document.querySelector('[role="dialog"]');
            return { undersized: small.slice(0, 12), count: small.length, width: Math.round(dialog.getBoundingClientRect().width) };
        }"""
    )
    mobile.screenshot(path="qa/phase7-current/probe-drawer.png")
    mobile.close()
    browser.close()

print(json.dumps(report, indent=2))
