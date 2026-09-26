/**
 * Build the browser check page, serve it under the proxy's own Content
 * Security Policy, and run it in headless Chrome: workspace writes and reads
 * through the File System Access API, the handle remembered in IndexedDB
 * across a reload, and deletion in one action; then extraction and rubric
 * import in Chrome, compared with the same runs in Node.
 *
 *   node scripts/check-browser.ts   (needs Chrome or Chromium; set CHROME_PATH if not found)
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { CSP } from "../../proxy/src/security.ts";
import { chromePath } from "./chrome.ts";
import { runExtraction, SAMPLED, ZIP } from "../check/extraction.ts";
import { runRubricImports } from "../check/rubric.ts";
import { bytesSource } from "../src/core/index.ts";
import { makeZip } from "../test/builders.ts";

const here = fileURLToPath(new URL("..", import.meta.url));
const out = join(here, "dist-check");
execFileSync("npx", ["vite", "build", "check", "--outDir", out, "--emptyOutDir", "--logLevel", "error", "--base", "./"], {
  cwd: here,
  stdio: "inherit",
});

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};
const PACK = fileURLToPath(new URL("../../fixtures/synthetic/pack-01/", import.meta.url));
// A bulk download: two sampled students, one who isn't, and macOS noise (all fictional).
const sampleZip = makeZip({
  "100200301 - QUILL AVERY - report.docx": readFileSync(join(PACK, "submissions/sub-a.docx")),
  "late/100200303 - MARSH RILEY - report.pdf": readFileSync(join(PACK, "submissions/sub-b.pdf")),
  "100200399 - OTHER STUDENT - report.docx": readFileSync(join(PACK, "submissions/sub-c.docx")),
  "__MACOSX/._100200301 - QUILL AVERY - report.docx": "x",
});
const server = createServer((req, res) => {
  const path = normalize(new URL(req.url ?? "/", "http://x").pathname).replace(/^(\.\.[/\\])+/, "");
  if (path === "/favicon.ico") return void res.writeHead(204).end(); // Chrome asks for one unprompted
  try {
    const body =
      path === "/zips/sample.zip"
        ? sampleZip
        : path.startsWith("/pack/")
          ? readFileSync(join(PACK, path.slice("/pack/".length)))
          : readFileSync(join(out, path === "/" ? "index.html" : path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "text/html; charset=utf-8", "Content-Security-Policy": CSP });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as { port: number };

// A normal (persistent) profile, as the moderator's browser is. In Playwright's
// default incognito-style context, reading a folder handle back from
// IndexedDB crashes the page (seen with Chrome 153 and its headless shell).
const profile = mkdtempSync(join(tmpdir(), "feedbacker-chrome-"));
const browser = await chromium.launchPersistentContext(profile, { executablePath: chromePath() });
let failures = 0;
try {
  const page = browser.pages()[0] ?? (await browser.newPage());
  const problems: string[] = [];
  page.on("pageerror", (err) => problems.push(err.message));
  page.on("console", (msg) => msg.type() === "error" && problems.push(msg.text()));
  for (const step of ["1", "2"]) {
    await page.goto(`http://127.0.0.1:${port}/?step=${step}`);
    await page.waitForFunction(() => (window as any).__result, null, { timeout: 15_000 });
    for (const [name, ok, detail] of (await page.evaluate(() => (window as any).__result)) as [string, boolean, string?][]) {
      if (!ok) failures++;
      console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? `: ${detail}` : ""}`);
    }
  }
  // Extraction in Chrome (pdf.js in its worker, zips read through File slices),
  // compared with the same scenario in Node, which matches the Python core.
  await page.goto(`http://127.0.0.1:${port}/?step=3`);
  await page.waitForFunction(() => (window as any).__extraction, null, { timeout: 60_000 });
  const inChrome = (await page.evaluate(() => (window as any).__extraction)) as Record<string, unknown>;
  const ms = (await page.evaluate(() => (window as any).__extractionMs)) as number;
  const inNode = await runExtraction(async (name) => {
    const bytes = name === ZIP ? sampleZip : new Uint8Array(readFileSync(join(PACK, name)));
    return { bytes, source: bytesSource(name, bytes) };
  });
  for (const name of Object.keys(inNode)) {
    const same = JSON.stringify(inChrome[name]) === JSON.stringify(inNode[name]);
    if (!same) failures++;
    console.log(`${same ? "PASS" : "FAIL"} extraction in Chrome matches Node: ${name}`);
    if (!same) console.log(`    chrome: ${JSON.stringify(inChrome[name]).slice(0, 300)}\n    node:   ${JSON.stringify(inNode[name]).slice(0, 300)}`);
  }
  // Matching Node isn't enough on its own: both could fail the same way. Every
  // file must extract, except the marked view, which must be refused.
  const outcomes = Object.entries(inChrome)
    .filter(([name]) => name !== ZIP)
    .map(([name, r]) => [name, "error" in ((r as any).extract ?? {}) ? "refused" : `${(r as any).extract.blocks.length} blocks`]);
  const expected = outcomes.every(([name, o]) => (name === "marked-view-replica.pdf" ? o === "refused" : o.endsWith("blocks") && !o.startsWith("0 ")));
  if (!expected) failures++;
  console.log(`${expected ? "PASS" : "FAIL"} every file extracted in Chrome, and the marked view was refused: ${outcomes.map(([n, o]) => `${n.split("/").at(-1)} ${o}`).join(", ")}`);
  const zip = inChrome[ZIP] as { matched: Record<string, string>; ignored: number };
  const selected = Object.keys(zip.matched).sort().join(",") === SAMPLED.slice(0, 2).join(",") && zip.ignored === 1;
  if (!selected) failures++;
  console.log(`${selected ? "PASS" : "FAIL"} the zip gave up only the two sampled members, leaving one other file unopened`);
  // Rubric import in Chrome (xlsx and docx grids read through File slices), compared with Node.
  const rubricsInChrome = (await page.evaluate(() => (window as any).__rubrics)) as Record<string, unknown>;
  const rubricsInNode = await runRubricImports(async (name) => bytesSource(name, new Uint8Array(readFileSync(join(PACK, name)))));
  for (const name of Object.keys(rubricsInNode)) {
    const same = JSON.stringify(rubricsInChrome[name]) === JSON.stringify(rubricsInNode[name]) && !("error" in (rubricsInNode[name] as object));
    if (!same) failures++;
    console.log(`${same ? "PASS" : "FAIL"} rubric import in Chrome matches Node: ${name}`);
  }
  console.log(`(extraction of ${Object.keys(inNode).length - 1} files and the zip took ${ms.toFixed(0)} ms in Chrome)`);
  console.log(`Chrome ${browser.browser()?.version() ?? ""}, served with the proxy's Content Security Policy`);
  if (problems.length) {
    failures++;
    console.log(`FAIL console errors or policy violations:\n  ${problems.join("\n  ")}`);
  } else {
    console.log("PASS no console errors or policy violations");
  }
} finally {
  await browser.close();
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
