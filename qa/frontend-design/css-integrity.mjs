/**
 * Structural sanity check for the stylesheets: brace/paren balance, no stray
 * "selector {" left without a body (which browsers silently swallow along with
 * the rules that follow it), and no leftover placeholder tokens.
 *
 * Usage (from the repo root):
 *   node qa/frontend-design/css-integrity.mjs
 * or from frontend/:  npm run audit:css
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "frontend", "src");

function collectCss(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectCss(full));
    else if (entry.name.endsWith(".css")) out.push(full);
  }
  return out;
}

function collectSource(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSource(full));
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

let problems = 0;

for (const file of collectCss(srcDir)) {
  const label = file.replace(/\\/g, "/").split("/src/")[1];
  const raw = readFileSync(file, "utf8");
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, ""); // ignore comments

  const opens = (text.match(/\{/g) || []).length;
  const closes = (text.match(/\}/g) || []).length;
  if (opens !== closes) {
    console.log(`FAIL ${label}: unbalanced braces (${opens} open / ${closes} close)`);
    problems += 1;
  }

  const parens = (text.match(/\(/g) || []).length - (text.match(/\)/g) || []).length;
  if (parens !== 0) {
    console.log(`FAIL ${label}: unbalanced parentheses (${parens})`);
    problems += 1;
  }

  // An empty rule body is almost always a leftover of an edit gone wrong.
  if (/\{[ \t]*\}/.test(text)) {
    console.log(`WARN ${label}: empty rule body { }`);
    problems += 1;
  }

  // Undefined-token check: every var(--x) must be declared somewhere.
  const declared = new Set([...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  for (const other of collectCss(srcDir)) {
    if (other === file) continue;
    const otherText = readFileSync(other, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of otherText.matchAll(/(--[a-z0-9-]+)\s*:/g)) declared.add(m[1]);
  }
  // Custom properties can also be set inline from TSX (style={{ "--h": ... }}),
  // so scan the components for that pattern before calling one undeclared.
  const jsxTokens = new Set();
  for (const tsx of collectSource(srcDir)) {
    const t = readFileSync(tsx, "utf8");
    for (const m of t.matchAll(/"(--[a-z0-9-]+)"\s*:/g)) jsxTokens.add(m[1]);
  }
  for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g)) {
    const name = m[1];
    // Allow the documented self-referencing fallback form var(--x, 12px).
    const withFallback = new RegExp("var\\(\\s*" + name + "\\s*,");
    if (!declared.has(name) && !jsxTokens.has(name) && !withFallback.test(text)) {
      console.log(`WARN ${label}: var(${name}) is never declared anywhere`);
      problems += 1;
    }
  }
}

console.log(problems === 0 ? "\nCSS integrity: OK" : `\nCSS integrity: ${problems} problem(s)`);
process.exit(problems === 0 ? 0 : 1);
