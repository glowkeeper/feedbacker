/**
 * Browser check (#41): build the browser bundle, serve it under a strict
 * Content Security Policy, parse synthetic marked views in headless Chrome,
 * and compare the results with the Python parser's. Also records timings.
 *
 * `node scripts/browser.ts` (needs Chrome or Chromium; set CHROME_PATH if not found)
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { chromium } from "playwright-core";
import { chromePath } from "./chrome.ts";

// No inline script or eval, and the page may talk only to its own origin.
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self'",
  "connect-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
};

execFileSync("npx", ["vite", "build", "--logLevel", "error"], { stdio: "inherit" });

const dir = mkdtempSync(join(tmpdir(), "marked-view-browser-"));
const cases: Record<string, string> = {
  replica: "../../fixtures/synthetic/pack-01/marked-view-replica.pdf",
  "chrome-printed": join(dir, "chrome-printed.pdf"),
};
execFileSync("node", ["scripts/make_browser_case.ts", cases["chrome-printed"]]);
const reference = JSON.parse(
  execFileSync("uv", ["run", "--quiet", "--project", "../../core", "python", "scripts/dump_marked_view.py", ...Object.values(cases)], {
    encoding: "utf8",
  }),
);

const notFound: string[] = [];
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const file = url.pathname.startsWith("/cases/")
    ? cases[url.pathname.slice("/cases/".length)]
    : join("dist", normalize(url.pathname === "/" ? "index.html" : url.pathname).replace(/^(\.\.[/\\])+/, ""));
  try {
    const body = readFileSync(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Content-Security-Policy": CSP });
    res.end(body);
  } catch {
    notFound.push(url.pathname);
    res.writeHead(404).end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as { port: number };

const browser = await chromium.launch({ executablePath: chromePath() });
let failures = 0;
try {
  const page = await browser.newPage();
  const problems: string[] = [];
  page.on("console", (msg) => msg.type() === "error" && problems.push(msg.text()));
  page.on("pageerror", (err) => problems.push(err.message));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${new URL(r.url()).pathname}`));
  await page.goto(`http://127.0.0.1:${port}/`);
  console.log(`Chrome ${browser.version()}, served with CSP: ${CSP}`);
  for (const [name, path] of Object.entries(cases)) {
    const runs: number[] = [];
    let view: unknown;
    for (let i = 0; i < 5; i++) {
      const result = await page.evaluate((u) => (window as any).parseFrom(u), `/cases/${name}`);
      runs.push(result.ms);
      view = result.view;
    }
    const ok = isDeepStrictEqual(view, reference[path].view);
    if (!ok) failures++;
    const warm = [...runs.slice(1)].sort((a, b) => a - b)[2];
    console.log(
      `${ok ? "PASS" : "FAIL"} ${name}: ${ok ? "matches the Python parser" : "differs from the Python parser"}; ` +
        `first parse ${runs[0].toFixed(0)} ms, then median ${warm.toFixed(0)} ms`,
    );
    if (!ok) console.log(`  python: ${JSON.stringify(reference[path].view)}\n  chrome: ${JSON.stringify(view)}`);
  }
  if (problems.length) {
    failures++;
    console.log(`FAIL console errors or CSP violations:\n  ${problems.join("\n  ")}\n  not found: ${notFound.join(", ")}`);
  } else {
    console.log("PASS no console errors or CSP violations");
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failures ? 1 : 0);
