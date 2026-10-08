/**
 * The website (`site/`), audited as the app's screens are (`a11y-audit.ts`): each page in Chrome, against the measured
 * WCAG 2.2 AA checks, and at a phone's width. The site is served over a local web server, as GitHub Pages serves it
 * (root-relative addresses work, and a missing address gets 404.html), and a missing address is audited too.
 *
 *   node scripts/check-site.ts
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { auditScreen } from "./a11y-audit.ts";
import { chromePath } from "./chrome.ts";

const site = fileURLToPath(new URL("../../site/", import.meta.url));
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain", ".xml": "application/xml" };

/** As GitHub Pages: a file by its path ("/" is index.html), or else 404.html with status 404. */
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://site").pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(site, path.endsWith("/") ? `${path}index.html` : path);
  let status = 200;
  if (!file.startsWith(site) || !existsSync(file) || !statSync(file).isFile()) {
    file = join(site, "404.html");
    status = 404;
  }
  res.writeHead(status, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

const pages = [...readdirSync(site).filter((f) => f.endsWith(".html") && f !== "404.html"), "no/such/page"]; // the last, as a visitor meets 404.html
const browser = await chromium.launch({ executablePath: chromePath() });
let failures = 0;
try {
  for (const name of pages) {
    for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]] as const) {
      const page = await browser.newPage({ viewport });
      await page.goto(new URL(name, base).href);
      const issues = await auditScreen(page, `${name} (${label})`);
      if (issues.length) failures++;
      console.log(`${issues.length ? "FAIL" : "PASS"} ${name} at ${label} width meets the measured WCAG 2.2 AA checks${issues.length ? `\n    ${issues.join("\n    ")}` : ""}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failures ? 1 : 0);
