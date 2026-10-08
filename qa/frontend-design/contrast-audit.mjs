/**
 * WCAG contrast audit for the OncoEasy design tokens.
 *
 * Reads the token values straight out of src/index.css so the numbers can
 * never drift from the shipped palette, then checks every foreground /
 * background pair the codebase actually uses for text.
 *
 * Usage (from the repo root):
 *   node qa/frontend-design/contrast-audit.mjs
 * or from frontend/:  npm run audit:contrast
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "..", "frontend", "src", "index.css"), "utf8");

const tokens = {};
for (const match of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
  tokens[match[1]] = match[2];
}

function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  let value = hex.replace("#", "");
  if (value.length === 3) value = value.split("").map((c) => c + c).join("");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function ratio(fgHex, bgHex) {
  const fg = luminance(fgHex);
  const bg = luminance(bgHex);
  const [hi, lo] = fg > bg ? [fg, bg] : [bg, fg];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = {
  white: tokens.surface ?? "#ffffff",
  page: tokens.page ?? "#fbfaf7",
  sunken: tokens["surface-sunken"] ?? "#f7faf9",
  teal50: tokens["teal-50"] ?? "#eaf7f4",
  brand50: tokens["brand-50"] ?? "#f1f7f8",
  amberTint: tokens["amber-100"] ?? "#fff1cc",
  greenTint: tokens["green-100"] ?? "#e7f5ef",
  blueTint: tokens["blue-100"] ?? "#e6eff8",
  brandTint: tokens["brand-100"] ?? "#dbe8f1",
  cream: "#fffaf0",
  /* Filled action surfaces: the foreground is the button label. */
  tealFill: tokens["teal-600"] ?? "#00786f",
  brandFill: tokens["brand-800"] ?? "#0c2947"
};

/** [label, foreground token, [background keys], minimum required ratio] */
const PAIRS = [
  ["body text on white", "ink", ["white"], 4.5],
  ["secondary text on white", "muted", ["white"], 4.5],
  ["metadata text on white", "faint", ["white"], 4.5],
  ["secondary text on page", "muted", ["page"], 4.5],
  ["metadata text on page", "faint", ["page"], 4.5],
  ["secondary text on sunken", "muted", ["sunken"], 4.5],
  ["metadata text on sunken", "faint", ["sunken"], 4.5],
  ["secondary text on teal tint", "muted", ["teal50"], 4.5],
  ["metadata text on brand tint", "faint", ["brand50"], 4.5],
  ["eyebrow / link teal", "teal-700", ["white", "page", "teal50"], 4.5],
  ["action teal text", "teal-600", ["white", "page", "teal50"], 4.5],
  ["deep teal text", "teal-800", ["white", "teal50"], 4.5],
  ["primary button label (white on action teal)", "#ffffff", ["tealFill", "brandFill"], 4.5],
  ["eyebrow / link teal on cream", "teal-700", ["cream"], 4.5],
  ["amber kicker text on cream", "amber-700", ["cream"], 4.5],
  ["navy heading on white", "brand-800", ["white"], 4.5],
  ["navy heading on page", "brand-800", ["page"], 4.5],
  ["link navy on white", "brand-700", ["white"], 4.5],
  ["badge brand", "brand-700", ["brand50", "brandTint"], 4.5],
  ["badge rx (amber text on amber tint)", "amber-700", ["amberTint"], 4.5],
  ["badge success (green on green tint)", "green-700", ["greenTint", "white"], 4.5],
  ["badge cold (blue on blue tint)", "blue-700", ["blueTint", "white"], 4.5],
  ["danger text", "red-600", ["white"], 4.5]
];

let failures = 0;
const rows = [];

for (const [label, fgToken, bgKeys, min] of PAIRS) {
  for (const bgKey of bgKeys) {
    const bg = SURFACES[bgKey];
    // The foreground may be a token name or a literal hex (the white button label).
    const isLiteral = Boolean(fgToken && fgToken.startsWith("#"));
    const fgValue = isLiteral ? fgToken : fgToken ? tokens[fgToken] : "#ffffff";
    if (!bg || !fgValue) {
      rows.push({
        label,
        bgKey,
        note: !bg ? "missing surface " + bgKey : "missing token " + fgToken
      });
      continue;
    }
    const value = ratio(fgValue, bg);
    const pass = value >= min;
    if (!pass) failures += 1;
    rows.push({ label, fg: fgValue, bgKey, bg, ratio: Number(value.toFixed(2)), min, pass });
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad("pair", 46), pad("fg", 9), pad("bg", 9), pad("ratio", 7), pad("min", 5), "result");
for (const row of rows) {
  if (row.note) {
    console.log(pad(row.label, 46), row.note);
    continue;
  }
  console.log(
    pad(row.label + " [" + row.bgKey + "]", 46),
    pad(row.fg, 9),
    pad(row.bg, 9),
    pad(row.ratio, 7),
    pad(row.min, 5),
    row.pass ? "PASS" : "FAIL"
  );
}

console.log("\n" + failures + " failing pair(s) of " + rows.filter((r) => !r.note).length);

/** Candidate replacements, checked against every surface they must clear. */
const CANDIDATES = {
  "teal-600 (action fill + teal text)": ["#00a99d", "#00958c", "#008b82", "#00807a", "#00786f", "#00736c"],
  "teal-700 (eyebrow / link text)": ["#008c82", "#00807a", "#007a74", "#006b62"],
  "teal-800 (hover / deep text)": ["#006b62", "#005f57", "#00514a"],
  "muted (secondary text)": ["#617486", "#5b6e80", "#586b7d", "#556878"],
  "faint (metadata text)": ["#7d8f99", "#6b7d89", "#66788a", "#5f7183", "#5b6d80"],
  "amber-700 (rx badge / amber text)": ["#9a6a0f", "#8f610c", "#84590a", "#7a520a"],
  "green-700": ["#1d6b4f", "#1a6047"],
  "blue-700": ["#3f74a8", "#3a6b9b"]
};

console.log("\n--- candidate sweeps ---");
for (const [name, list] of Object.entries(CANDIDATES)) {
  console.log("\n" + name);
  for (const hex of list) {
    const onWhite = ratio(hex, "#ffffff").toFixed(2);
    const onPage = ratio(hex, SURFACES.page).toFixed(2);
    const onTint = ratio(hex, SURFACES.teal50).toFixed(2);
    const onAmber = ratio(hex, SURFACES.amberTint).toFixed(2);
    const whiteOnIt = ratio("#ffffff", hex).toFixed(2);
    console.log(
      "  " + hex +
      "  onWhite=" + onWhite +
      "  onPage=" + onPage +
      "  onTealTint=" + onTint +
      "  onAmberTint=" + onAmber +
      "  whiteOnThis=" + whiteOnIt
    );
  }
}
