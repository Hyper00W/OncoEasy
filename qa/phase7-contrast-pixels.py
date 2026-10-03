"""Ground-truth contrast check.

The selector-based audit resolves text colour against the nearest opaque
*background-color*, which is wrong wherever a section paints a gradient or an
image. This script re-checks the flagged elements against the actually
rendered pixels in a full-page screenshot.
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:5173"
OUT = Path("qa/phase7-current")

TARGETS = {
    "/": ["h3", "p", ".eyebrow", ".footer-links a", ".footer-bottom span"],
    "/pharmacy": ["h3", ".footer-links a", ".eyebrow", "p"],
}


def linear(lum):
    return np.where(lum <= 0.03928, lum / 12.92, ((lum + 0.055) / 1.055) ** 2.4)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    results = []

    for route, selectors in TARGETS.items():
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.goto(f"{BASE_URL}{route}", wait_until="domcontentloaded")
        try:
            page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            page.wait_for_timeout(800)
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(1200)

        boxes = page.evaluate(
            """(selectors) => {
                const out = [];
                for (const selector of selectors) {
                  for (const el of [...document.querySelectorAll(selector)].slice(0, 5)) {
                    const text = (el.textContent || '').trim();
                    if (!text) continue;
                    const style = getComputedStyle(el);
                    if (style.visibility === 'hidden' || style.display === 'none') continue;
                    const rect = el.getBoundingClientRect();
                    if (rect.width < 8 || rect.height < 6) continue;
                    // Skip clipped/off-canvas elements (e.g. inactive carousel
                    // slides) so the pixel crop is never a partial sliver.
                    if (rect.right > window.innerWidth || rect.left < 0) continue;
                    if (rect.bottom > document.body.scrollHeight) continue;
                    out.push({
                      selector,
                      sample: text.slice(0, 30),
                      fontSize: parseFloat(style.fontSize),
                      fontWeight: parseInt(style.fontWeight, 10),
                      x: Math.round(rect.x + window.scrollX),
                      y: Math.round(rect.y + window.scrollY),
                      w: Math.round(rect.width),
                      h: Math.round(rect.height)
                    });
                  }
                }
                return out;
            }""",
            selectors,
        )
        page.screenshot(path=str(OUT / f"contrast-{route.strip('/') or 'home'}.png"), full_page=True)
        page.close()

        image = np.asarray(Image.open(OUT / f"contrast-{route.strip('/') or 'home'}.png").convert("RGB")).astype(np.float32)
        for box in boxes:
            crop = image[box["y"] : box["y"] + box["h"], box["x"] : box["x"] + box["w"]]
            if crop.size == 0:
                continue
            lum = (0.2126 * crop[:, :, 0] + 0.7152 * crop[:, :, 1] + 0.0722 * crop[:, :, 2]) / 255.0
            flat = lum.ravel()
            low = np.percentile(flat, 2)
            high = np.percentile(flat, 98)
            lin_low, lin_high = float(linear(np.array(low))), float(linear(np.array(high)))
            ratio = (lin_high + 0.05) / (lin_low + 0.05)
            large = box["fontSize"] >= 24 or (box["fontSize"] >= 18.66 and box["fontWeight"] >= 600)
            needed = 3 if large else 4.5
            results.append(
                {
                    "route": route,
                    **box,
                    "pixelRatio": round(ratio, 2),
                    "needed": needed,
                    "pass": ratio >= needed,
                }
            )
    browser.close()

(OUT / "contrast-pixels.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
failures = [r for r in results if not r["pass"]]
print(json.dumps({"sampled": len(results), "pixelFailures": len(failures)}, indent=2))
for entry in failures:
    print("FAIL", entry)
for entry in results:
    if entry["pass"] and entry["pixelRatio"] < 5:
        print("borderline", entry["route"], entry["selector"], entry["sample"], entry["pixelRatio"], ">=", entry["needed"])
