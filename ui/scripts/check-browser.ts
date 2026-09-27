/**
 * Build the browser check page, serve it under the proxy's own Content
 * Security Policy, and run it in headless Chrome: workspace writes and reads
 * through the File System Access API, the handle remembered in IndexedDB
 * across a reload, and deletion in one action; then extraction and rubric
 * import in Chrome, compared with the same runs in Node.
 *
 *   node scripts/check-browser.ts   (needs Chrome or Chromium; set CHROME_PATH if not found)
 */

import { execFileSync, spawn } from "node:child_process";
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
import { caseBlock, caseDigests, runRedactions } from "../check/anonymise.ts";
import { bytesSource, parseMarkedView } from "../src/core/index.ts";
import { makeZip } from "../test/builders.ts";

const here = fileURLToPath(new URL("..", import.meta.url));
const out = join(here, "dist-check");
execFileSync("npx", ["vite", "build", "check", "--outDir", out, "--emptyOutDir", "--logLevel", "error", "--base", "./"], {
  cwd: here,
  stdio: "inherit",
});

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
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
// Marked views for the sample above (the replica under each sampled ID, fictional), and one other.
const viewsZip = makeZip({
  "100200301 - QUILL AVERY - report.docx.pdf": readFileSync(join(PACK, "marked-view-replica.pdf")),
  "100200303 - MARSH RILEY - report.docx.pdf": readFileSync(join(PACK, "marked-view-replica.pdf")),
  "100200399 - OTHER STUDENT - report.docx.pdf": "never opened",
  "download_report.txt": "Failed file count: 0\n",
});
const server = createServer((req, res) => {
  const path = normalize(new URL(req.url ?? "/", "http://x").pathname).replace(/^(\.\.[/\\])+/, "");
  if (path === "/favicon.ico") return void res.writeHead(204).end(); // Chrome asks for one unprompted
  try {
    const body =
      path === "/zips/sample.zip"
        ? sampleZip
        : path === "/zips/views.zip"
          ? viewsZip
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
  // The marked-view parser in Chrome (pdf.js in its worker), compared with Node.
  const viewInChrome = await page.evaluate(() => (window as any).__markedView);
  const viewInNode = await parseMarkedView(new Uint8Array(readFileSync(join(PACK, "marked-view-replica.pdf"))));
  const viewSame = JSON.stringify(viewInChrome) === JSON.stringify(viewInNode) && viewInNode.warnings.length === 0;
  if (!viewSame) failures++;
  console.log(`${viewSame ? "PASS" : "FAIL"} the marked view parses in Chrome exactly as in Node`);
  // Anonymisation: Chrome's Unicode data must give the same case rules and classes as Node's.
  const chromeDigests = (await page.evaluate(() => (window as any).__cases)) as string[];
  const nodeDigests = caseDigests();
  const differing: string[] = [];
  for (const [block, digest] of nodeDigests.entries()) {
    if (digest === chromeDigests[block]) continue;
    const inChrome = (await page.evaluate((b) => (window as any).__caseBlock(b), block)) as string[];
    const inNode = caseBlock(block);
    differing.push(...inNode.filter((line, i) => line !== inChrome[i]).map((line, i) => `node ${line} / chrome ${inChrome[inNode.indexOf(line)]}`).slice(0, 3));
  }
  if (differing.length) failures++;
  console.log(`${differing.length ? "FAIL" : "PASS"} case rules and character classes in Chrome match Node for every code point${differing.length ? `\n    ${differing.slice(0, 8).join("\n    ")}` : ""}`);
  const redactionsSame = JSON.stringify(await page.evaluate(() => (window as any).__redactions)) === JSON.stringify(runRedactions());
  if (!redactionsSame) failures++;
  console.log(`${redactionsSame ? "PASS" : "FAIL"} redaction in Chrome matches Node`);
  console.log(`(extraction of ${Object.keys(inNode).length - 1} files and the zip took ${ms.toFixed(0)} ms in Chrome)`);
  console.log(`Chrome ${browser.browser()?.version() ?? ""}, served with the proxy's Content Security Policy`);
  // The app (#19), operated from the keyboard (and file inputs): open an empty
  // workspace, set up a moderation step by step, and see it in the overview.
  await page.goto(`http://127.0.0.1:${port}/app.html`);
  await page.waitForFunction(() => (window as any).__appReady, null, { timeout: 30_000 });
  const heading = async () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  const press = async (name: string) => {
    await page.getByRole("button", { name, exact: true }).focus();
    await page.keyboard.press("Enter");
  };
  // Each step's screen, and the heading that must take focus when it opens.
  const HEADINGS: Record<string, string> = {
    Overview: "Moderation overview",
    Request: "Moderation request",
    Originals: "Original submissions",
    Rubric: "Source rubric",
    Brief: "Assessment brief",
    Anonymisation: "Anonymisation",
  };
  const unfocused: string[] = [];
  const step = async (name: string) => {
    await press(name);
    const focused = await page
      .waitForFunction((h) => document.activeElement?.textContent?.trim() === h, HEADINGS[name], { timeout: 5_000 })
      .then(() => true, () => false);
    if (!focused) unfocused.push(name);
  };
  const status = () => page.locator('[role="status"]').first().innerText();
  const appNotes: string[] = [];
  const expectStep = async (what: string, ok: () => Promise<boolean>) => {
    const passed = await ok().catch(async (err: Error) => {
      const shown = (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ");
      appNotes.push(`${what} stopped: ${err.message.split("\n")[0]} (${err.message.match(/waiting for (.*)/)?.[1] ?? ""}); the page shows: ${shown.slice(-600)}`);
      return false;
    });
    if (!passed) appNotes.push(`${what}: ${(await status().catch(() => "")) || (await page.locator('[role="alert"]').allInnerTexts()).join(" / ")}`);
    return passed;
  };

  const chooserFocused = (await heading()) === "Open a workspace";
  await press("Choose a workspace folder…");
  await page.getByRole("heading", { name: "Moderation overview" }).waitFor({ timeout: 15_000 });
  const emptyOk = (await page.getByText("No moderation request has been recorded yet.").isVisible()) && (await heading()) === "Moderation overview";

  await step("Request");
  await page.locator("#sample").fill("60-69:100200301\n100200303");
  await page.locator("#module").fill("Fictional Module 101");
  await press("Record the request");
  const requestOk = await expectStep("request", async () => {
    await page.getByText("Recorded the request: 2 sampled submissions").waitFor({ timeout: 15_000 });
    return true;
  });

  await step("Originals");
  await page.locator("#originals").setInputFiles({ name: "sample.zip", mimeType: "application/zip", buffer: Buffer.from(sampleZip) });
  await press("Import the originals");
  const originalsOk = await expectStep("originals", async () => {
    await page.getByText("Imported 2 of the sampled originals").waitFor({ timeout: 30_000 });
    return (await status()).includes("1 other file(s) in the download were not opened");
  });

  await step("Rubric");
  await page.locator("#rubric-file").setInputFiles(join(PACK, "rubric-grid.xlsx"));
  await press("Read the rubric");
  const rubricOk = await expectStep("rubric", async () => {
    await page.getByRole("heading", { name: "Check the rubric before saving it" }).waitFor({ timeout: 15_000 });
    const previewFocused = (await heading()) === "Check the rubric before saving it";
    const labelsShown = await page.getByRole("rowheader", { name: "Exceptional (100)" }).first().isVisible();
    await press("Save this rubric");
    await page.getByText("Saved the rubric").waitFor({ timeout: 15_000 });
    return previewFocused && labelsShown;
  });

  await step("Brief");
  await page.locator("#brief-file").setInputFiles(join(PACK, "brief.docx"));
  await press("Import the brief");
  const briefOk = await expectStep("brief", async () => {
    await page.getByText("Imported the brief").waitFor({ timeout: 15_000 });
    return true;
  });

  await step("Anonymisation");
  await page.locator("#rule-names").fill("Morgan Ellis");
  await press("Add to the rules");
  const anonymisedOk = await expectStep("anonymisation", async () => {
    await page.getByText("Added to the rules").waitFor({ timeout: 15_000 });
    await press("Anonymise now");
    await page.getByText("Anonymised. sub-001:").waitFor({ timeout: 30_000 });
    return true;
  });
  const reviewOk = await expectStep("review", async () => {
    await press("Review sub-001 [STUDENT_A]");
    await page.getByRole("heading", { name: "Review sub-001 [STUDENT_A]" }).waitFor({ timeout: 15_000 });
    const focused = (await heading()) === "Review sub-001 [STUDENT_A]";
    const text = await page.locator("pre.text").innerText();
    // No real value anywhere on the page until the moderator asks for them.
    // (The student's name, QUILL AVERY; the fictional text also has a username, aquill99, which only a rule redacts.)
    const hiddenFirst = text.includes("[STUDENT_A]") && !/avery/i.test(await page.locator("main").innerText());
    await page.getByRole("checkbox", { name: "Show the real values" }).focus();
    await page.keyboard.press("Space");
    await page.getByText("These are real names and details").waitFor({ timeout: 15_000 });
    const shownOnRequest = await page
      .locator("main table")
      .last()
      .getByRole("cell", { name: /avery/i })
      .first()
      .waitFor({ timeout: 15_000 })
      .then(() => true, () => false);
    await press("Approve this text for the AI reading");
    await page.getByText("Approved sub-001 [STUDENT_A]: exactly this text").waitFor({ timeout: 15_000 });
    await press("Review The brief");
    await page.getByRole("heading", { name: "Review The brief" }).waitFor({ timeout: 15_000 });
    const briefHidden = !(await page.locator("main").innerText()).includes("Morgan Ellis");
    await press("Approve this text for the AI reading");
    await page.getByText("Approved The brief").waitFor({ timeout: 15_000 });
    if (!(focused && hiddenFirst && shownOnRequest && briefHidden)) appNotes.push(`review parts: ${JSON.stringify({ focused, hiddenFirst, shownOnRequest, briefHidden })}`);
    return focused && hiddenFirst && shownOnRequest && briefHidden;
  });

  await step("Overview");
  await page.getByRole("table").waitFor({ timeout: 15_000 });
  const rows = await page.locator("tbody tr").allInnerTexts();
  const steps = await page.locator(".steps").innerText();
  const banner = await page.locator("header").innerText();
  const overviewOk =
    banner.includes("/Users/moderator/Feedbacker/workspaces/app-check") &&
    rows.length === 2 &&
    rows[0].includes("[STUDENT_A]") &&
    rows[0].includes("60-69") &&
    /Done/.test(rows[0]) &&
    /Rubric\s+Done/.test(steps) &&
    /Brief imported\s+Done/.test(steps) &&
    /Brief approved\s+Done/.test(steps) &&
    /Done\s+Done\s+Done/.test(rows[0]); // original, anonymised, approved
  const focusOk = unfocused.length === 0;
  const appOk = chooserFocused && emptyOk && requestOk && originalsOk && rubricOk && briefOk && anonymisedOk && reviewOk && overviewOk && focusOk;
  if (!appOk) failures++;
  console.log(`${appOk ? "PASS" : "FAIL"} the app sets up a moderation from the keyboard: request, originals, a previewed grid rubric, the brief, anonymisation with review (real values only on request) and approval; the overview shows each step; focus moves to each step's heading`);
  if (!appOk) console.log(`    steps: ${JSON.stringify({ chooserFocused, emptyOk, requestOk, originalsOk, rubricOk, briefOk, anonymisedOk, reviewOk, overviewOk, unfocused })}\n    ${appNotes.join("\n    ")}\n    rows: ${JSON.stringify(rows)}`);

  // If the proxy stops answering after a screen has rendered, focus moves to the error's heading.
  await page.goto(`http://127.0.0.1:${port}/app.html?health=fail`);
  await page.getByRole("heading", { name: "The proxy can't be reached" }).waitFor({ timeout: 15_000 });
  const errorFocused = (await heading()) === "The proxy can't be reached";
  if (!errorFocused) failures++;
  console.log(`${errorFocused ? "PASS" : "FAIL"} if the proxy stops answering, focus moves to the error screen's heading`);

  // The built app, served by the real proxy (its own process, no key), from the address it prints.
  execFileSync("npx", ["vite", "build", "--logLevel", "error"], { cwd: here, stdio: "inherit" });
  const proxyData = mkdtempSync(join(tmpdir(), "feedbacker-proxy-"));
  const proxyProcess = spawn(process.execPath, ["src/main.ts", "--port", "0", "--app", join(here, "dist"), "--data", proxyData], {
    cwd: join(here, "..", "proxy"),
    env: { ...process.env, ANTHROPIC_API_KEY: "", FEEDBACKER_ENV: join(proxyData, "none.env") },
  });
  try {
    const address = await new Promise<string>((resolve, reject) => {
      let output = "";
      proxyProcess.stdout.on("data", (chunk) => {
        output += chunk;
        const m = /Open: (http:\/\/127\.0\.0\.1:\d+\/#token=[\w-]+)/.exec(output);
        if (m) resolve(m[1]);
      });
      proxyProcess.on("exit", () => reject(new Error(`the proxy stopped: ${output}`)));
    });
    const response = await page.goto(address);
    const csp = (await response?.headerValue("content-security-policy")) ?? "";
    await page.getByText("Proxy connected; API key not configured").waitFor({ timeout: 15_000 });
    const realOk = csp === CSP && !page.url().includes("token") && (await page.getByRole("heading", { name: "Open a workspace" }).isVisible());
    if (!realOk) failures++;
    console.log(`${realOk ? "PASS" : "FAIL"} the real proxy serves the built app under its CSP; the app takes the session token from the address, removes it, and reaches the proxy`);
  } finally {
    proxyProcess.kill();
    rmSync(proxyData, { recursive: true, force: true });
  }

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
