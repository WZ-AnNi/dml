/**
 * Real-browser check for the TSDML counter example.
 *
 * The vitest suite runs against the in-memory test host; this runs the same
 * component in Chromium. Things only a browser can prove — that a keyed `@for`
 * keeps the SAME DOM node instead of rebuilding, that `@if` mounts on a real
 * click, that the SVG host patching does not throw, and that the page's own
 * branding renders — are asserted here.
 *
 * Usage:
 *   npx vite --port 5199 --strictPort      # in another shell (repo: examples/tsdml-counter)
 *   node test/browser.mjs
 *
 * Playwright is resolved from the local project; set PLAYWRIGHT_MODULE to an
 * absolute path to use an installed copy elsewhere (no dependency is added to
 * this package just for this check).
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadChromium() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright", "playwright-core"].filter(Boolean);
  for (const id of candidates) {
    try {
      return require(id).chromium;
    } catch {
      /* try the next one */
    }
  }
  console.error(
    "playwright not found — run `npm i -D playwright` (or set PLAYWRIGHT_MODULE=/abs/path/to/playwright)",
  );
  process.exit(1);
}

const chromium = loadChromium();
const URL = process.env.TSDML_URL ?? "http://localhost:5199/";
const SHOT = process.env.TSDML_SHOT ?? "browser-counter.png";

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  -> ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

// Vite inlines small SVGs as a data URL, so accept either form.
const isTsdmlMark = (src) => /tsdml(-dark)?\.svg$/.test(src ?? "") || /TSDML/.test(src ?? "");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const consoleErrors = [];
const pageErrors = [];
page.on("console", (msg) => msg.type() === "error" && consoleErrors.push(msg.text()));
page.on("pageerror", (err) => pageErrors.push(String(err)));

await page.goto(URL, { waitUntil: "load" });
await page.waitForSelector(".panel", { timeout: 15_000 });

// --- components, props, slots ---------------------------------------------
check("panel title (component prop)", (await page.textContent(".panel h2")) === "Counter demo");
check("badge with a literal tone", (await page.textContent("span.green")) === "TSDML");
check("badge with the `??` fallback evaluated", (await page.textContent("span.badge")) === "no tone");
check(
  "named slot landed in the panel footer",
  (await page.textContent(".panel-footer .footer-note")) === "panel footer",
);
check("slotted element is not a positional child", (await page.locator(".panel-body .footer-note").count()) === 0);

// --- branding -------------------------------------------------------------
const framework = await page.getAttribute("img.framework", "src");
check("hero uses the tsdml mark", isTsdmlMark(framework), framework?.slice(0, 60));
check("hero mark has a real alt", (await page.getAttribute("img.framework", "alt")) === "tsdml");
const links = await page.$$eval("#docs a", (as) =>
  as.map((a) => ({ text: a.textContent.trim(), href: a.href, icon: a.querySelector("img")?.getAttribute("src") })),
);
check(
  "docs link points at TSDML (not solidjs.com)",
  links.some((l) => l.text === "Explore TSDML" && /github\.com/.test(l.href)),
  links.map((l) => ({ text: l.text, href: l.href })),
);
check("docs link icon is the tsdml mark", links.some((l) => isTsdmlMark(l.icon)), links.map((l) => l.text));
check("no other-framework wording on the page", !/solid/i.test((await page.textContent("body")) ?? ""));

// --- @if ------------------------------------------------------------------
check("@if hidden while the condition is false", (await page.locator(".hot").count()) === 0);
const button = page.locator("button.counter");
await button.click();
await button.click();
check("@if still hidden at count 2", (await page.locator(".hot").count()) === 0);
await button.click();
await page.waitForSelector(".hot", { timeout: 5000 });
check("@if mounted at count 3", (await page.textContent(".hot")) === "hot!");
check("button text is reactive", (await page.textContent("button.counter")) === "Count is 3");

// --- @for + keyed reuse ---------------------------------------------------
const tickText = () => page.$$eval(".tick-list li", (els) => els.map((e) => e.textContent));
check("@for rendered the list", JSON.stringify(await tickText()) === JSON.stringify(["tick 1", "tick 2", "tick 3"]));

// mark the first item: a rebuild loses the mark, a keyed move keeps it
await page.$eval(".tick-list li", (el) => (el.dataset.persisted = "yes"));
await button.click();
const after = await page.$$eval(".tick-list li", (els) =>
  els.map((e) => ({ text: e.textContent, persisted: e.dataset.persisted ?? null })),
);
check(
  "@for appended the 4th item",
  JSON.stringify(after.map((a) => a.text)) === JSON.stringify(["tick 1", "tick 2", "tick 3", "tick 4"]),
  after.map((a) => a.text),
);
check("keyed @for REUSED the existing DOM node", after[0].persisted === "yes", after[0]);

check("no uncaught page errors", pageErrors.length === 0, pageErrors);
check("no console errors", consoleErrors.length === 0, consoleErrors);

await page.screenshot({ path: SHOT, fullPage: true });
console.log(`screenshot: ${SHOT}`);
await browser.close();

console.log(failures === 0 ? "\nBROWSER TEST: ALL PASSED" : `\nBROWSER TEST: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
