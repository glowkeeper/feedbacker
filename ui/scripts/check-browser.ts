/**
 * Build the browser check page, serve it under the proxy's own Content
 * Security Policy, and run it in headless Chrome: workspace writes and reads
 * through the File System Access API, the handle remembered in IndexedDB
 * across a reload, and deletion in one action; then extraction and rubric
 * import in Chrome, compared with the same runs in Node.
 *
 *   node scripts/check-browser.ts   (needs Chrome or Chromium; set CHROME_PATH if not found)
 *   SLOW=4 node scripts/check-browser.ts   (Chrome's processor slowed four times, to find steps that only pass on a fast computer)
 *   WIDE=1 node scripts/check-browser.ts   (every screen in a wide font: Verdana (macOS, Windows) or DejaVu Sans (most Linux,
 *                                           and what CI's Linux used), whichever is installed, refusing to run if neither is.
 *                                           It finds layout problems that only show with wider fonts. It lifts the app's
 *                                           Content Security Policy to add the font, so the normal run checks the policy)
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Locator } from "playwright-core";
import { CSP } from "../../proxy/src/security.ts";
import { auditScreen } from "./a11y-audit.ts";
import { chromePath } from "./chrome.ts";
import { runExtraction, SAMPLED, ZIP } from "../check/extraction.ts";
import { runRubricImports } from "../check/rubric.ts";
import { caseBlock, caseDigests, runRedactions } from "../check/anonymise.ts";
import { bytesSource, parseMarkedView, VERSION } from "../src/core/index.ts";
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
// A marking cohort's bulk download: two students, the platform's report, and a file whose name carries no ID (all fictional).
const cohortZip = makeZip({
  "100200401 - LARK DEVON - report.docx": readFileSync(join(PACK, "submissions/sub-c.docx")),
  "100200402 - FENN SASHA - report.pdf": readFileSync(join(PACK, "figures/report-with-figures.pdf")), // with charts, to review
  "manifest.txt": "The requested files are now available",
  "reading list.docx": "never opened",
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
const wide = process.env.WIDE === "1";
const browser = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), bypassCSP: wide });
let failures = 0;
try {
  const page = browser.pages()[0] ?? (await browser.newPage());
  if (wide) {
    await page.addInitScript(() =>
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = '* { font-family: Verdana, "DejaVu Sans", monospace !important; }';
        document.head.append(style);
      }),
    );
  }
  /**
   * Whether a wide font is installed: text measured in it differs from the same text in a fallback, which it can only
   * if the font is there (extra letter spacing or a larger size didn't find what these fonts' shapes do).
   */
  const wideFontInstalled = () =>
    page.evaluate(() => {
      const width = (font: string) => {
        const context = document.createElement("canvas").getContext("2d")!;
        context.font = `32px ${font}`;
        return context.measureText("mmmmmmmmmmlliWW").width;
      };
      return ["Verdana", '"DejaVu Sans"'].filter((font) => width(`${font}, monospace`) !== width("monospace"));
    });
  if (wide) {
    const fonts = await wideFontInstalled();
    if (!fonts.length) {
      console.log("FAIL WIDE=1 needs a wide font: Verdana (macOS, Windows) or DejaVu Sans (on Linux, the fonts-dejavu package); neither is installed");
      process.exit(1);
    }
    console.log(`NOTE every screen in ${fonts[0].replaceAll('"', "")}, a wide font`);
  }
  const slow = Number(process.env.SLOW ?? 1);
  if (slow > 1) await (await browser.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: slow });
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
  // The app, operated from the keyboard (and file inputs): open an empty
  // workspace, set up a moderation step by step, and see it in the overview.
  await page.goto(`http://127.0.0.1:${port}/app.html`);
  await page.waitForFunction(() => (window as any).__appReady, null, { timeout: 30_000 });
  const heading = async () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  // A busy screen ignores presses (its buttons stay focusable, marked aria-disabled), and can still be finishing after what
  // the check waited for has appeared: so a press waits for its button to be ready, then presses it regardless.
  const press = async (name: string) => {
    const button = page.getByRole("button", { name, exact: true });
    await button.focus();
    await button.and(page.locator(':not([aria-disabled="true"])')).waitFor({ timeout: 15_000 }).catch(() => undefined);
    await page.keyboard.press("Enter");
  };
  // Each step's screen, and the heading that must take focus when it opens.
  const HEADINGS: Record<string, string> = {
    Overview: "Moderation overview",
    Request: "Moderation request",
    "Original files": "Original submissions",
    Rubric: "Source rubric",
    Brief: "Assessment brief",
    Anonymisation: "Anonymisation",
    "Original marking": "Original marking",
    "AI reading": "AI reading",
    Review: "Review",
    Export: "Export",
  };
  const unfocused: string[] = [];
  const step = async (name: string) => {
    await press(name);
    const focused = await page
      .waitForFunction((h) => document.activeElement?.textContent?.trim() === h, HEADINGS[name], { timeout: 5_000 })
      .then(() => true, () => false);
    if (!focused) unfocused.push(name);
  };
  // Open a disclosure by its summary, from the keyboard, unless it is open already (options, and folded actions).
  const disclose = async (summary: string) => {
    const details = page.locator("details", { has: page.locator(":scope > summary", { hasText: summary }) }).first();
    if (await details.evaluate((d) => (d as HTMLDetailsElement).open)) return;
    await details.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
  };
  // The comparison and verdict follow the review window: its button in the list of criteria goes down to them.
  const toComparison = async () => {
    await page.getByRole("button", { name: /^Comparison and verdict/ }).focus();
    await page.keyboard.press("Enter");
  };
  const status = () => page.locator('[role="status"]').first().innerText();
  // Whether something is shown, waiting for it: a screen can show its heading before what it loads.
  const shown = (what: Locator) => what.waitFor({ timeout: 15_000 }).then(() => true, () => false);
  // Whether something has gone, waiting for it: a screen can still be updating after what the check waited for appeared.
  const vanished = (what: Locator) => what.first().waitFor({ state: "detached", timeout: 15_000 }).then(() => true, () => false);
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

  const a11y: string[] = [];
  // SCREENSHOTS=<folder> also saves each audited screen, for showing a change on its pull request (synthetic data only).
  const shots = process.env.SCREENSHOTS;
  const audit = async (screen: string) => {
    // Taken before the audit, which resizes the window to check reflow.
    if (shots) await page.screenshot({ path: `${shots}/${screen.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}.png`, fullPage: !screen.startsWith("Review (") }); // the review is sized to the window, so it is taken as the window shows it
    a11y.push(...(await auditScreen(page, screen)));
  };
  // Your work (ADR 0008): the pages, a word on what Feedbacker is, and nothing that isn't built yet. The workspaces
  // folder isn't asked for until it is needed, so progress waits for it.
  const homeFocused =
    (await heading()) === "Your work" &&
    JSON.stringify(await page.getByRole("navigation", { name: "Feedbacker" }).getByRole("button").allInnerTexts()) === JSON.stringify(["Your work", "Marking", "Moderation"]) &&
    (await shown(page.getByText("Continue to see how far it has got.").first())) &&
    (await page.getByRole("navigation", { name: "About Feedbacker" }).getByRole("link").count()) === 6 &&
    !/calibration/i.test(await page.locator("main").innerText());
  // A workspace whose folder has gone is set apart, and can be removed from the list, deleting nothing.
  const lostShown = (await page.locator("#lost-heading + p + ul").getByRole("heading", { name: "gone" }).count()) === 1;
  await audit("Your work (the folder not yet chosen)");
  await press("Remove from the list: gone");
  await page.getByRole("status").filter({ hasText: "Removed gone from the list. Nothing was deleted." }).waitFor({ timeout: 15_000 });
  const lostRemoved = await page.getByRole("heading", { name: "Can't be found" }).waitFor({ state: "detached", timeout: 15_000 }).then(() => true, () => false);
  // New work by name: a name that can't name a folder is refused, with why; a good one asks for the folder (the stand-in
  // "chooses" it), starts the work and opens it.
  await press("New marking");
  await page.getByRole("heading", { name: "Marking", level: 1 }).waitFor({ timeout: 15_000 });
  const nameFocused = await page.evaluate(() => document.activeElement?.id === "new-name");
  await page.locator("#new-name").fill("../elsewhere");
  await press("Start the marking");
  await page.getByText("a name can have only letters, digits, spaces, hyphens, underscores and full stops").waitFor({ timeout: 15_000 });
  const chosenTimes = () => page.evaluate(() => (window as unknown as { __chosen?: number }).__chosen ?? 0);
  const notAskedYet = (await chosenTimes()) === 0; // a name that can't be used asks nothing
  await audit("Marking (a name refused)");
  await page.locator("#new-name").fill("CS101 2026");
  await press("Start the marking");
  await page.getByRole("heading", { name: "Marking overview" }).waitFor({ timeout: 15_000 });
  const startedNew = (await page.locator(".workspace-head").innerText()).startsWith("Marking workspace CS101 2026") && (await chosenTimes()) === 1;
  // Its overview says how far it has got, in the same words as Your work.
  const overviewProgress = await shown(page.locator("p.progress").filter({ hasText: "0 of 7 steps done. Next: The assessment: no assessment recorded yet." }));
  await disclose("Marking workspace CS101 2026");
  await press("Close this workspace");
  await page.getByRole("heading", { name: "Marking", level: 1 }).waitFor({ timeout: 15_000 });
  const closedToList = await shown(page.locator("#list-heading + ul").getByRole("heading", { name: "CS101 2026" }));
  // Your work now shows how far each has got, under its kind.
  await press("Your work");
  await page.getByRole("heading", { name: "Your work", level: 1 }).waitFor({ timeout: 15_000 });
  await page.getByText("0 of 7 steps done. Next: Moderation request: no moderation request recorded yet.").waitFor({ timeout: 15_000 });
  const listedOk =
    (await page.locator("#marking-heading + ul").getByRole("heading", { name: "mark-check" }).count()) === 1 &&
    (await page.locator("#moderation-heading + ul").getByRole("heading", { name: "app-check" }).count()) === 1 &&
    (await page.getByText("Started 27 September 2026; kept for 90 days after the work is finished.").count()) === 1;
  await audit("Your work");
  await press("Continue app-check");
  await page.getByRole("heading", { name: "Moderation overview" }).waitFor({ timeout: 15_000 });
  const homeParts = { homeFocused, lostShown, lostRemoved, nameFocused, notAskedYet, startedNew, overviewProgress, closedToList, listedOk };
  if (!Object.values(homeParts).every(Boolean)) appNotes.push(`home parts: ${JSON.stringify(homeParts)}`);
  const chooserFocused = Object.values(homeParts).every(Boolean);
  const emptyOk = (await shown(page.getByText("No moderation request has been recorded yet."))) && (await heading()) === "Moderation overview";
  await audit("Overview (empty)");

  await step("Request");
  // The sample a row per band: a second row is added from the keyboard, and focus moves into it.
  await page.locator("#sample-0-band").fill("60-69");
  await page.locator("#sample-0-ids").fill("100200301");
  await press("Add another band of the sample");
  const rowFocused = await page.evaluate(() => document.activeElement?.id === "sample-1-band");
  await page.locator("#sample-1-ids").fill("100200303");
  await page.locator("#bands-0-label").fill("60-69");
  await page.locator("#bands-0-count").fill("12");
  await page.locator("#module").fill("Fictional Module 101");
  await press("Record the request");
  const requestOk = await expectStep("request", async () => {
    await page.getByText("Recorded the request: 2 sampled submissions").waitFor({ timeout: 15_000 });
    if (!rowFocused) appNotes.push("request: focus didn't move into the added row");
    // What's recorded: the status line agrees with the navigation, each pseudonym is beside its real ID, and the form is folded away.
    await page.getByRole("heading", { name: "What's recorded" }).waitFor({ timeout: 15_000 });
    const recordedFocused = (await heading()) === "What's recorded";
    // Read at once, not waited for: the status changes together with what is recorded.
    const said = (await page.locator(".step-line").innerText()) === "Done: 2 sampled submissions, Fictional Module 101.";
    const sample = await page.getByRole("table", { name: /^The sample/ }).locator("tbody tr").allInnerTexts();
    const matched = sample[0] === "sub-001\t[STUDENT_A]\t100200301\t60-69" && sample[1] === "sub-002\t[STUDENT_B]\t100200303\tNot listed";
    const folded = (await page.locator("details.step-form > summary").innerText()) === "Change the request" && !(await page.locator("#sample-0-band").isVisible());
    // Changing it starts from what is recorded.
    await page.locator("details.step-form > summary").focus();
    await page.keyboard.press("Enter");
    const prefilled = (await page.locator("#sample-0-ids").inputValue()) === "100200301" && (await page.locator("#module").inputValue()) === "Fictional Module 101";
    await page.locator("details.step-form > summary").focus();
    await page.keyboard.press("Enter"); // folded again
    const parts = { rowFocused, recordedFocused, said, matched, folded, prefilled };
    if (!Object.values(parts).every(Boolean)) appNotes.push(`request parts: ${JSON.stringify({ ...parts, sample })}`);
    return Object.values(parts).every(Boolean);
  });

  await audit("Request");
  await step("Original files");
  // Before anything is imported: every sampled submission is listed as not yet imported, and the form stays open.
  const originalsTable = page.getByRole("table", { name: /^Each sampled submission's original file/ });
  await originalsTable.waitFor({ timeout: 15_000 }); // read when the screen opens
  const beforeRows = await originalsTable.locator("tbody tr").allInnerTexts();
  const listedBefore = beforeRows.length === 2 && beforeRows.every((r) => r.includes("\tNot yet\t")) && (await page.locator("details.step-form").count()) === 0;
  if (!listedBefore) appNotes.push(`originals before import: ${JSON.stringify(beforeRows)}`);
  await page.locator("#originals").setInputFiles({ name: "sample.zip", mimeType: "application/zip", buffer: Buffer.from(sampleZip) });
  await press("Import the originals");
  const originalsOk = await expectStep("originals", async () => {
    await page.getByText("Imported 2 of the sampled originals").waitFor({ timeout: 30_000 });
    const notOpened = (await status()).includes("1 other file(s) in the download were not opened");
    // What's recorded: each sampled original, imported, with its format; the form folded away.
    const rows = await page.getByRole("table", { name: /^Each sampled submission's original file/ }).locator("tbody tr").allInnerTexts();
    const listed = rows.length === 2 && rows.every((r) => r.includes("\tImported\t"));
    const folded = (await page.locator("details.step-form > summary").innerText()) === "Import the originals again";
    if (!(notOpened && listed && folded)) appNotes.push(`originals parts: ${JSON.stringify({ notOpened, listed, folded, rows })}`);
    return listedBefore && notOpened && listed && folded;
  });

  await audit("Originals");
  await step("Rubric");
  await page.locator("#rubric-file").setInputFiles(join(PACK, "rubric-grid.xlsx"));
  await press("Read the rubric");
  const rubricOk = await expectStep("rubric", async () => {
    await page.getByRole("heading", { name: "Check the rubric before saving it" }).waitFor({ timeout: 15_000 });
    const previewFocused = (await heading()) === "Check the rubric before saving it";
    const labelsShown = await shown(page.getByRole("rowheader", { name: "Exceptional (100)" }).first());
    // The grid gives no weights: one is entered per criterion, by its title, and the total is kept up to date.
    const boxes = page.getByRole("group", { name: "Criterion weights" }).getByRole("textbox");
    const n = await boxes.count();
    for (let i = 0; i < n; i++) await boxes.nth(i).fill(String(100 / n));
    const totalled = await shown(page.getByText("Total: 100%"));
    // A mistyped weight is refused beside the Save button; the preview stays open with everything entered, to correct in place.
    await boxes.nth(0).fill("inf");
    const untotalled = await shown(page.getByText("Total: a weight isn't a number yet."));
    await press("Save this rubric");
    await page.getByText("The rubric wasn't saved:").waitFor({ timeout: 15_000 });
    const kept = (await boxes.count()) === n && (await boxes.nth(n - 1).inputValue()) === String(100 / n);
    await boxes.nth(0).fill(String(100 / n));
    await audit("Rubric (preview)");
    await press("Save this rubric");
    await page.getByText("Saved the rubric").waitFor({ timeout: 15_000 });
    const savedFocused = (await heading()) === "What's recorded"; // the preview closed, so focus moved to what was saved
    const savedShown =
      (await page.getByRole("table", { name: /^Each criterion, its weight and its levels/ }).innerText()).includes("25%") &&
      (await page.locator("details.levels > summary").count()) === n &&
      (await page.locator("details.step-form > summary").innerText()) === "Import the rubric again";
    const weighted = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("app-ws");
      const rubric = JSON.parse(await (await (await dir.getFileHandle("rubric.json")).getFile()).text());
      return rubric.criteria.every((c: { weight: number | null }) => c.weight !== null);
    });
    if (!(n > 0 && totalled && untotalled && kept && weighted && savedFocused && savedShown)) appNotes.push(`rubric parts: ${JSON.stringify({ n, totalled, untotalled, kept, weighted, savedFocused, savedShown })}`);
    return previewFocused && labelsShown && savedFocused && savedShown && n > 0 && totalled && untotalled && kept && weighted;
  });

  await step("Brief");
  await page.locator("#brief-file").setInputFiles(join(PACK, "brief.docx"));
  await press("Import the brief");
  const briefOk = await expectStep("brief", async () => {
    await page.getByText("Imported the brief").waitFor({ timeout: 15_000 });
    // What's recorded: imported, not yet approved, with the way to Anonymisation.
    const said = (await page.locator(".step-line").innerText()) === "Needs attention: imported; anonymise and approve it on Anonymisation."; // at once: no lag
    const way = (await page.getByRole("button", { name: "Go to Anonymisation" }).count()) === 1;
    if (!(said && way)) appNotes.push(`brief parts: ${JSON.stringify({ said, way, line: await page.locator(".step-line").innerText() })}`);
    return said && way;
  });

  await audit("Brief");

  // Before anything is approved, a plan says there is nothing to read, with no estimate to confirm; closing it moves focus to the heading.
  await step("AI reading");
  const nothingOk = await expectStep("nothing to read", async () => {
    // The brief isn't approved yet: said in the app's terms, not the command line's.
    await press("Plan the reading");
    await page.getByText('the brief has not been anonymised; review and approve it under Anonymisation, or untick "Include the approved brief" to read without it').waitFor({ timeout: 15_000 });
    await page.getByRole("checkbox", { name: "Include the approved brief (recommended)" }).uncheck();
    await press("Plan the reading");
    await page.getByRole("heading", { name: "Nothing to read yet" }).waitFor({ timeout: 15_000 });
    const focusedFirst = (await heading()) === "Nothing to read yet";
    const noConfirm = (await page.getByRole("button", { name: "Confirm and send" }).count()) === 0;
    const why = (await page.getByText("Not included:").count()) === 1;
    await audit("AI reading (nothing to read)");
    await press("Close");
    await page.getByText("Nothing was sent.").waitFor({ timeout: 15_000 });
    const back = (await heading()) === "AI reading";
    if (!(focusedFirst && noConfirm && why && back)) appNotes.push(`nothing to read parts: ${JSON.stringify({ focusedFirst, noConfirm, why, back })}`);
    return focusedFirst && noConfirm && why && back;
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
    const text = await page.getByRole("region", { name: "The anonymised text of sub-001 [STUDENT_A]" }).innerText();
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
    await audit("Anonymisation (review, real values shown)");
    await press("Approve this text for the AI");
    await page.getByText("Approved sub-001 [STUDENT_A]: exactly this text").waitFor({ timeout: 15_000 });
    const approvedKept = (await heading()) === "Approved"; // focus stays on the button, now done
    await press("Review The brief");
    await page.getByRole("heading", { name: "Review The brief" }).waitFor({ timeout: 15_000 });
    const briefHidden = !(await page.locator("main").innerText()).includes("Morgan Ellis");
    await press("Approve this text for the AI");
    await page.getByText("Approved The brief").waitFor({ timeout: 15_000 });
    if (!(focused && hiddenFirst && shownOnRequest && briefHidden && approvedKept)) appNotes.push(`review parts: ${JSON.stringify({ focused, hiddenFirst, shownOnRequest, briefHidden, approvedKept })}`);
    return focused && hiddenFirst && shownOnRequest && briefHidden && approvedKept;
  });

  await step("Original marking");
  const views = { name: "views.zip", mimeType: "application/zip", buffer: Buffer.from(viewsZip) };
  await page.locator("#views").setInputFiles(views);
  await press("Import the marking");
  const markingOk = await expectStep("marking", async () => {
    await page.getByText("Imported the marking for 2 sampled submission(s)").waitFor({ timeout: 30_000 });
    // The marker's criterion that didn't match the rubric is offered by name; its rubric criterion is chosen, and the marking is imported again.
    const match = page.getByRole("combobox", { name: "The marker's “PROFESSIONALISM”" });
    await match.waitFor({ timeout: 15_000 });
    await audit("Original marking (match the marker's criteria)");
    await match.focus();
    await match.selectOption({ label: "Reflection and professional practice" });
    await page.locator("#views").setInputFiles(views);
    await page.getByRole("checkbox", { name: /^Replace marking already imported/ }).check();
    await press("Import the marking");
    await page.getByText("Imported the marking for 2 sampled submission(s)").waitFor({ timeout: 30_000 });
    const matched = await vanished(match); // matched, so no longer offered
    await press("Check the marker marking of sub-001 [STUDENT_A]");
    await page.getByRole("heading", { name: "The marking of sub-001 (marker)" }).waitFor({ timeout: 15_000 });
    const focused = (await heading()) === "The marking of sub-001 (marker)";
    // The check: a table by criterion title, with what the import noted under "Please check:", and nothing left out.
    const summary = await page.locator('section[aria-labelledby="summary-heading"]').innerText();
    const byTitle = summary.includes("Requirements and design") && !summary.includes("requirements-and-design");
    await audit("Original marking (check)");
    await press("Confirm this marking");
    await page.getByText("Confirmed the original marking of sub-001 (marker)").waitFor({ timeout: 15_000 });
    const confirmedKept = (await heading()) === "Confirmed"; // focus stays on the button, now done
    // Every record loads and nothing is left to match, so the actions are folded away; hand entry is folded too.
    const folded = (await page.locator("details.step-form > summary").first().innerText()) === "Import or enter marking again";
    await page.locator("summary", { hasText: "Import or enter marking again" }).focus();
    await page.keyboard.press("Enter");
    await page.locator("summary", { hasText: "Enter or correct marking by hand" }).focus();
    await page.keyboard.press("Enter");
    // An empty entry is refused, and so is replacing the imported record without saying so.
    await press("Enter the marking");
    await page.getByText("enter an overall mark, a mark for at least one criterion, or a comment; nothing was entered").waitFor({ timeout: 15_000 });
    await page.locator("#entry-overall").fill("50");
    await press("Enter the marking");
    await page.getByText(/^sub-001 already has marking imported from its marked view for the marker;/).waitFor({ timeout: 15_000 });
    await page.locator("#entry-overall").fill("");
    const importedKept = (await page.getByRole("button", { name: "Check the marker marking of sub-001 [STUDENT_A]" }).count()) === 1;
    // A second marker's record, entered by hand, is listed beside the imported one.
    // (sub-002's marking is left unconfirmed, so it can be reviewed blind below.)
    await page.locator("#entry-id").selectOption("sub-001");
    await page.locator("#entry-marker").fill("second marker");
    await page.locator("#entry-overall").fill("58");
    await page.getByRole("textbox", { name: "Implementation", exact: true }).fill("58");
    await press("Enter the marking");
    await page.getByText("Entered the marking of sub-001 (second marker)").waitFor({ timeout: 15_000 });
    const listed = (await page.getByRole("button", { name: "Check the second marker marking of sub-001 [STUDENT_A]" }).count()) === 1;
    if (!confirmedKept) appNotes.push("marking: focus left the confirm button");
    if (!matched) appNotes.push("marking: the matched criterion is still offered");
    const checked = byTitle && summary.includes("Not yet") && summary.includes("between Good (65) and Very good (75)") && summary.includes("Please check:");
    if (!(checked && folded)) appNotes.push(`marking check: ${JSON.stringify({ byTitle, folded, summary: summary.slice(0, 300) })}`);
    return matched && listed && focused && confirmedKept && importedKept && checked && folded;
  });

  await step("AI reading");
  const readingOk = await expectStep("reading", async () => {
    await press("Plan the reading");
    await page.getByRole("heading", { name: "Check the estimate before anything is sent" }).waitFor({ timeout: 15_000 });
    const planFocused = (await heading()) === "Check the estimate before anything is sent";
    const planned = await page.locator("main table").last().innerText();
    await audit("AI reading (plan)");
    const skippedShown = (await page.getByText("sub-002: sub-002 has not been approved for the AI").count()) > 0;
    await press("Confirm and send");
    await page.getByRole("heading", { name: "What came back" }).waitFor({ timeout: 30_000 });
    const resultFocused = (await heading()) === "What came back";
    const came = await page.locator("main").innerText();
    await audit("AI reading (results)");
    return planFocused && planned.includes("sub-001") && !planned.includes("sub-002") && skippedShown && resultFocused && came.includes("sub-001: read");
  });

  // A rule added after approval: nothing of the text it now covers is sent until it is anonymised and approved again.
  await step("Anonymisation");
  const lateRuleOk = await expectStep("late rule", async () => {
    // Rules exist, so their form is folded away: opened to add one.
    const rulesFolded = !(await page.locator("#rule-names").isVisible());
    if (!rulesFolded) appNotes.push("late rule: the rules form wasn't folded away once rules existed");
    await disclose("Add to the rules");
    await page.locator("#rule-redact-0-text").fill("risky"); // a word in sub-001's text
    await page.locator("#rule-redact-0-kind").selectOption("PROJECT");
    await press("Add to the rules");
    await page.getByText("Added to the rules").waitFor({ timeout: 15_000 });
    await step("AI reading");
    await disclose("More options");

    await page.getByRole("checkbox", { name: "Read again submissions already read" }).check();
    await press("Plan the reading");
    await page.getByText(/sub-001: sub-001: its approved text contains something the anonymisation rules or pseudonym key now redact/).waitFor({ timeout: 15_000 });
    const valueHidden = !/risky/i.test(await page.locator("main").innerText());
    // Anonymised and approved again, it is read again (so what follows reviews the current text).
    await step("Anonymisation");
    await press("Anonymise now");
    await page.getByText(/sub-001: \d+ redaction\(s\); needs approval/).waitFor({ timeout: 30_000 });
    await press("Review sub-001 [STUDENT_A]");
    await page.getByRole("heading", { name: "Review sub-001 [STUDENT_A]" }).waitFor({ timeout: 15_000 });
    await press("Approve this text for the AI");
    await page.getByText("Approved sub-001 [STUDENT_A]").waitFor({ timeout: 15_000 });
    await step("AI reading");
    await disclose("More options");

    await page.getByRole("checkbox", { name: "Read again submissions already read" }).check();
    await press("Plan the reading");
    await page.getByRole("heading", { name: "Check the estimate before anything is sent" }).waitFor({ timeout: 15_000 });
    const plannedAgain = (await page.locator("main table").last().innerText()).includes("sub-001");
    await press("Confirm and send");
    await page.getByRole("heading", { name: "What came back" }).waitFor({ timeout: 30_000 });
    const parts = { valueHidden, plannedAgain };
    if (!Object.values(parts).every(Boolean)) appNotes.push(`late rule parts: ${JSON.stringify(parts)}`);
    return Object.values(parts).every(Boolean);
  });

  // A batch: sent, waited for, checked and collected from the keyboard; the waiting section survives leaving the screen.
  const batchOk = await expectStep("batch", async () => {
    await step("AI reading");
    await disclose("More options");

    await page.getByRole("checkbox", { name: "Read again submissions already read" }).check();
    await page.getByRole("checkbox", { name: "Ask the model again even where nothing has changed" }).check();
    await page.getByRole("checkbox", { name: "Send as one batch, at half the price" }).check();
    await press("Plan the reading");
    await page.getByRole("heading", { name: "Check the estimate before anything is sent" }).waitFor({ timeout: 15_000 });
    const priced = (await page.locator("main").innerText()).includes("Sent as one batch");
    await audit("AI reading (batch plan)");
    await press("Confirm and send the batch");
    await page.getByRole("heading", { name: "Waiting for a batch" }).waitFor({ timeout: 15_000 });
    const waitingFocused = (await heading()) === "Waiting for a batch";
    // Each message carries its own kind: sent is done, even after "Nothing was sent." above (info).
    const sentDone = (await page.locator(".message.done").filter({ hasText: "as one batch" }).count()) === 1;
    await audit("AI reading (batch waiting)");
    await step("Overview");
    await step("AI reading");
    await page.getByText(/Still in progress|It has finished/).waitFor({ timeout: 15_000 });
    const kept = (await page.getByRole("heading", { name: "Waiting for a batch" }).count()) === 1;
    let progressInfo = true; // checking only reports progress: info, whatever came before
    if ((await page.getByRole("button", { name: "Check now", exact: true }).count()) > 0) {
      await press("Check now");
      await page.getByRole("button", { name: "Collect the results", exact: true }).waitFor({ timeout: 15_000 });
      progressInfo = (await page.locator(".message.info").count()) === 1 && (await page.locator(".message.done").count()) === 0;
    }
    await press("Collect the results");
    await page.getByRole("heading", { name: "What came back" }).waitFor({ timeout: 30_000 });
    const collected = (await heading()) === "What came back" && (await page.locator("main").innerText()).includes("sub-001: read");
    const gone = await vanished(page.getByRole("heading", { name: "Waiting for a batch" }));
    const parts = { priced, waitingFocused, sentDone, kept, progressInfo, collected, gone };
    if (!Object.values(parts).every(Boolean)) appNotes.push(`batch parts: ${JSON.stringify(parts)}`);
    return Object.values(parts).every(Boolean);
  });

  // Review is locked while sub-002's text isn't approved: the step says so, and its screen lists what is left, with the way there.
  const lockedOk = await expectStep("review locked", async () => {
    const statusShown = (await page.locator("#step-status-review").innerText()) === "Locked";
    await press("Review");
    await page.waitForFunction(() => document.activeElement?.textContent === "Review isn't available yet", null, { timeout: 15_000 });
    const reason = (await page.getByText("Approve the anonymised text of 1 more submission").count()) === 1;
    await audit("Review (locked)");
    await press("Go to Anonymisation");
    await page.waitForFunction(() => document.activeElement?.textContent === "Anonymisation", null, { timeout: 15_000 });
    await press("Review sub-002 [STUDENT_B]");
    await page.getByRole("heading", { name: "Review sub-002 [STUDENT_B]" }).waitFor({ timeout: 15_000 });
    await press("Approve this text for the AI");
    await page.getByText("Approved sub-002 [STUDENT_B]").waitFor({ timeout: 15_000 });
    const unlocked = await page.waitForFunction(() => document.querySelector("#step-status-review")?.textContent !== "Locked", null, { timeout: 15_000 }).then(() => true, () => false);
    const parts = { statusShown, reason, unlocked };
    if (!Object.values(parts).every(Boolean)) appNotes.push(`review locked parts: ${JSON.stringify(parts)}`);
    return Object.values(parts).every(Boolean);
  });

  await step("Review");
  const judgedOk = await expectStep("judgement", async () => {
    await press("Review this submission");
    await page.getByRole("heading", { name: "Reviewing sub-001 [STUDENT_A]" }).waitFor({ timeout: 15_000 });
    // Nothing but the choice is shown until the moderator chooses how to review.
    const choiceFirst = !(await page.locator("main").innerText()).includes("Suggested level:");
    await press("Review openly");
    await page.getByText("Reviewing sub-001 openly.").waitFor({ timeout: 15_000 });
    const focused = (await heading()) === "Reviewing sub-001 [STUDENT_A]";
    const shown = await page.locator("main").innerText();
    // The text, brief, both markers' marking and the AI reading, together; no real name.
    const together =
      shown.includes("[STUDENT_A]") &&
      !/avery/i.test(shown) &&
      (await page.getByText("The assessment brief").count()) === 1 &&
      shown.includes("second marker:") &&
      shown.includes("Suggested level:");
    const first = page.locator("fieldset.judge").first();
    // Two panes: the submission and one criterion; a quote the AI reading found is shown in the text, highlighted, and focus stays put.
    const panes = (await page.locator("div.review > section.pane").count()) === 2 && (await page.locator("div.review fieldset.judge").count()) === 1;
    // On a wide window the review fills it, brought to its top on opening: each pane scrolls on its own, and never the page.
    const layout = await page.evaluate(() => {
      const frame = (document.querySelector(".review-frame") as HTMLElement).getBoundingClientRect();
      const text = document.querySelector(".review-text") as HTMLElement;
      const style = getComputedStyle(text);
      return { top: frame.top, height: frame.height, window: window.innerHeight, overflow: style.overflowY, overscroll: style.overscrollBehaviorY, scrolls: text.scrollHeight > text.clientHeight };
    });
    const fitted = Math.abs(layout.top) < 2 && Math.abs(layout.height - layout.window) < 2 && layout.overflow === "auto" && layout.overscroll === "contain" && layout.scrolls;
    if (!fitted) appNotes.push(`fitted: ${JSON.stringify(layout)}`);
    const show = page.getByRole("button", { name: /^Show in the text for quote 1 of the AI reading of / });
    await show.focus();
    const scrolledBefore = await page.evaluate(() => window.scrollY); // before the highlight, so any page movement it causes is seen
    await page.keyboard.press("Enter");
    const markShown = await page.locator(".review-text mark").waitFor({ timeout: 5_000 }).then(() => true, () => false);
    const pageStill = (await page.evaluate(() => window.scrollY)) === scrolledBefore; // only the text pane moved
    const quoteKept = markShown && (await page.evaluate(() => document.activeElement?.textContent ?? "")).startsWith("Show in the text");
    const highlightSaid = (await page.locator(".review-text [role=status]").innerText()).startsWith("Highlighted in the submission: quote 1");
    await audit("Review (open, a quote highlighted)");
    // Starting from the AI reading chooses its suggested level and puts its draft into the comment, adapted from the keyboard;
    // both are recorded as taken from the AI.
    await page.getByRole("button", { name: /^Start from the AI reading for / }).first().focus();
    await page.keyboard.press("Enter");
    const levelChosen = (await first.locator("input[type=radio]:checked").count()) === 1 && (await first.getByText("The level is the AI's suggestion").count()) === 1;
    const toComment = await page.evaluate(() => (document.activeElement as HTMLTextAreaElement | null)?.value ?? "");
    await page.keyboard.press("End");
    await page.keyboard.type(" The design is clear.");
    const adapting = (await first.getByText("Adapted from the AI draft").count()) === 1;
    // The mark starts at the level's points; the lowest quick pick moves it within the level, from the keyboard.
    const markBox = first.locator("input.mark");
    const startMark = await markBox.inputValue();
    const pick = first.locator(".mark-row button").first();
    const pickedMark = ((await pick.textContent()) ?? "").trim();
    const pickNamed = (await pick.getAttribute("aria-label")) === `${pickedMark} for Requirements and design`;
    await pick.focus();
    await page.keyboard.press("Enter");
    const moved = pickNamed && startMark !== "" && pickedMark !== startMark && (await markBox.inputValue()) === pickedMark && (await pick.getAttribute("aria-pressed")) === "true";
    const button = first.getByRole("button", { name: /^Record the judgement of / });
    const name = (await button.textContent()) ?? "";
    await button.focus();
    await page.keyboard.press("Enter");
    await page.getByText(/^Recorded your judgement of /).waitFor({ timeout: 15_000 });
    const stayed = (await page.evaluate(() => document.activeElement?.textContent)) === name.replace("Record the", "Change the"); // the same button, its judgement now recorded
    const status = await first.locator("xpath=..").innerText();
    const recorded = status.includes("Your judgement:");
    const derived = toComment === "Consider the brief." && adapting && status.includes("comment adapted from the AI draft") && levelChosen && status.includes("level taken from the AI suggestion");
    // The comparison, on the page after the last criterion: the judged criterion beside both markers and the AI, with differences in words.
    await toComparison();
    const named = (await page.getByRole("heading", { name: "Comparison: sub-001 [STUDENT_A]" }).count()) === 1;
    const pageFocused = (await heading()) === "Comparison: sub-001 [STUDENT_A]" && (await page.locator(".review-frame .comparison").count()) === 0; // below the panes, not in them
    const table = await page.getByRole("region", { name: "Comparison table" }).innerText();
    const compared = named && table.includes("The second marker") && /Agrees with your (level|mark)|Differs: /.test(table) && table.includes("Not yet judged") && moved && table.includes(`, mark ${pickedMark}`);
    if (!moved || !table.includes(`, mark ${pickedMark}`)) appNotes.push(`mark: ${JSON.stringify({ startMark, pickedMark, moved })}`);
    // The verdict, from the keyboard.
    await page.getByRole("radio", { name: /^Generous/ }).focus();
    await page.keyboard.press("Space");
    await page.locator("#verdict-mark").fill("58");
    await page.getByRole("button", { name: "Record the verdict" }).focus();
    await page.keyboard.press("Enter");
    await page.getByText("Recorded your verdict on sub-001: Generous.").waitFor({ timeout: 15_000 });
    const verdictStayed = (await page.evaluate(() => document.activeElement?.textContent?.trim())) === "Change the verdict";
    const verdictShown = (await page.getByText(/^Your verdict: Generous; suggested mark 58/).count()) === 1;
    // Its outcome is said beside the button, in the comparison and verdict, below the review window: not under the review's heading, out of view.
    const verdictNoted = (await page.locator(".comparison [role=status]").innerText()).includes("Recorded your verdict on sub-001: Generous.");
    await audit("Review (open, judged, verdict)");
    const parts = { choiceFirst, focused, together, panes, fitted, markShown, pageStill, quoteKept, highlightSaid, stayed, recorded, derived, pageFocused, compared, verdictStayed, verdictShown, verdictNoted };
    if (!Object.values(parts).every(Boolean)) appNotes.push(`judgement parts: ${JSON.stringify(parts)}`);
    return Object.values(parts).every(Boolean);
  });

  // Blind review of sub-002 (its text approved above): choose blind, and nothing of the marking or the reading shows until the reveal.
  const blindOk = await expectStep("blind review", async () => {
    await step("Review");
    await page.locator("#review-id").selectOption("sub-002");
    await press("Review this submission");
    await page.getByRole("heading", { name: "Reviewing sub-002 [STUDENT_B]" }).waitFor({ timeout: 15_000 });
    await press("Review blind");
    await page.getByText("Reviewing sub-002 blind").waitFor({ timeout: 15_000 });
    const blindFocused = (await heading()) === "Reviewing sub-002 [STUDENT_B]";
    const before = await page.locator("div.review").innerText(); // the review itself, not the step navigation
    const hiddenBefore =
      !/Original marking|AI reading|marker's marking overall|Suggested level/.test(before) && (await page.locator("main").innerText()).includes("0 of 4 criteria judged");
    await audit("Review (blind, before the reveal)");
    // The Original marking screen withholds it too.
    await step("Original marking");
    await page.getByText("Hidden until the reveal (reviewed blind)").waitFor({ timeout: 15_000 });
    const checkWithheld = await page.getByRole("button", { name: "Check the marker marking of sub-002 [STUDENT_B]" }).isDisabled();
    await audit("Original marking (blind withheld)");
    await step("Review");
    await page.locator("#review-id").selectOption("sub-002");
    await press("Review this submission");
    await page.getByRole("heading", { name: "Reviewing sub-002 [STUDENT_B]" }).waitFor({ timeout: 15_000 });
    // The reveal is refused until every criterion is judged.
    await press("Reveal the original marking and the AI reading");
    await page.getByText(/still to judge:/).waitFor({ timeout: 15_000 });
    // One criterion at a time: judge it, then Next, which moves focus to the next criterion's heading.
    const sets = page.locator("fieldset.judge");
    let nextFocused = true;
    for (let i = 0; i < 4; i++) {
      await sets.first().getByRole("radio").first().focus();
      await page.keyboard.press("Space");
      await sets.first().getByRole("button", { name: /^Record the judgement of / }).focus();
      await page.keyboard.press("Enter");
      await page.getByText(/^Recorded your judgement of /).waitFor({ timeout: 15_000 });
      await page.getByText(`${i + 1} of 4 criteria judged`).waitFor({ timeout: 15_000 });
      if (i < 3) {
        await page.getByRole("button", { name: /^Next: / }).focus();
        await page.keyboard.press("Enter");
        nextFocused &&= await page.waitForFunction((n) => document.activeElement?.textContent?.startsWith(`${n}. `) ?? false, i + 2, { timeout: 5_000 }).then(() => true, () => false);
      }
    }
    const stillHidden = !(await page.locator("main").innerText()).includes("marker's marking overall");
    await press("Reveal the original marking and the AI reading");
    await page.getByText("Revealed the original marking and the AI reading.").waitFor({ timeout: 15_000 });
    const revealFocused = (await heading()) === "Reviewing sub-002 [STUDENT_B]";
    const after = await page.locator("main").innerText();
    const shownAfter = after.includes("The marker's marking overall") && after.includes("marker:");
    // Back to the first criterion, from the list of criteria, to revise it.
    await page.locator("nav.criteria-nav button").first().focus();
    await page.keyboard.press("Enter");
    const first = sets.first();
    await first.getByRole("radio").nth(1).focus();
    await page.keyboard.press("Space");
    await first.getByRole("button", { name: /^Record a revision of / }).focus();
    await page.keyboard.press("Enter");
    await page.getByText(/^Recorded your revision of /).waitFor({ timeout: 15_000 });
    const bothKept = (await first.locator("xpath=..").innerText()).includes("revised after the reveal to");
    await toComparison();
    const revisedCompared = (await page.getByRole("region", { name: "Comparison table" }).innerText()).includes("(revised from ");
    await audit("Review (blind, revealed and revised)");
    const parts = { blindFocused, hiddenBefore, checkWithheld, nextFocused, stillHidden, revealFocused, shownAfter, bothKept, revisedCompared };
    if (!Object.values(parts).every(Boolean)) appNotes.push(`blind parts: ${JSON.stringify(parts)}`);
    return Object.values(parts).every(Boolean);
  });

  await step("Overview");
  const sample = page.getByRole("table", { name: /^Each sampled submission/ });
  await sample.waitFor({ timeout: 15_000 });
  const rows = await sample.locator("tbody tr").allInnerTexts();
  const bySubmission = page.getByRole("table", { name: "Agreement by submission" });
  await bySubmission.waitFor({ timeout: 15_000 });
  const agreed = await bySubmission.locator("tbody tr").allInnerTexts();
  const byCriterion = await page.getByRole("table", { name: "Agreement by criterion" }).locator("tbody tr").allInnerTexts();
  await audit("Overview (complete)");
  // The shared layout: "How this step works", no status line of its own, and no list repeating the steps' statuses.
  const shared =
    (await page.locator("summary", { hasText: "How this step works" }).count()) === 1 &&
    (await page.locator(".step-line").count()) === 0 &&
    (await page.locator("main dl.steps").count()) === 0;
  const banner = await page.locator(".workspace-head").innerText(); // the workspace's name and path, beside its menu
  const overviewOk =
    banner.includes("/Users/moderator/Feedbacker/workspaces/app-check") &&
    rows.length === 2 &&
    rows[0].includes("[STUDENT_A]") &&
    rows[0].includes("60-69") &&
    /Done/.test(rows[0]) &&
    shared &&
    /Done\s+Done\s+Done\s+Done\s+Done/.test(rows[0]) && // original, anonymised, approved, marking (confirmed), reading
    rows[1].split("\t")[5] === "Not confirmed" && // sub-002's marking, imported and left for after the reveal
    rows[0].includes("1 of 4 criteria (open)") &&
    rows[1].includes("4 of 4 criteria (blind, revealed)") &&
    rows[0].split("\t")[8] === "Generous" &&
    // Agreement: sub-001 compares its one judged criterion with both markers; sub-002 all four, once revealed.
    /^sub-001 \[STUDENT_A\]\t1\t\d+ agree/.test(agreed[0]) &&
    agreed[0].endsWith("Generous") &&
    /^sub-002 \[STUDENT_B\]\t4\t/.test(agreed[1]) &&
    byCriterion.length === 4 &&
    byCriterion.every((r) => /\t\d+\t/.test(r));
  // Export (locked until ready): it opens only once the record is ready, and until then its screen lists what is left; then the moderation is completed, approved and exported from the keyboard.
  const exportOk = await expectStep("export", async () => {
    await press("Export");
    await page.waitForFunction(() => document.activeElement?.textContent === "Export isn't available yet", null, { timeout: 15_000 });
    const listed = (await page.getByText(/^sub-001 \[STUDENT_A\]: still to judge: /).count()) === 1;
    const notAnError = (await page.getByText("This couldn't be done:").count()) === 0;
    // Each reason goes to the step where it is put right: judging on Review, confirming on Original marking.
    const linked = (await page.getByRole("button", { name: "Go to Review" }).count()) > 0 && (await page.getByRole("button", { name: "Go to Original marking" }).count()) > 0;
    await audit("Export (locked)");
    // Complete the moderation: sub-001's other criteria, sub-002's verdict, and its marking confirmed after the reveal.
    await step("Review");
    await press("Review this submission");
    await page.getByRole("heading", { name: "Reviewing sub-001 [STUDENT_A]" }).waitFor({ timeout: 15_000 });
    const sets = page.locator("fieldset.judge");
    for (let i = 1; i < 4; i++) {
      await page.locator("nav.criteria-nav button").nth(i).focus();
      await page.keyboard.press("Enter");
      await sets.first().getByRole("radio").first().focus();
      await page.keyboard.press("Space");
      await sets.first().getByRole("button", { name: /^Record the judgement of / }).focus();
      await page.keyboard.press("Enter");
      await page.getByText(/^Recorded your judgement of /).waitFor({ timeout: 15_000 });
    }
    // The verdict was given before these marks, so it is flagged; given again, it is current.
    await press("Review this submission");
    await page.waitForFunction(() => document.activeElement?.textContent === "Reviewing sub-001 [STUDENT_A]", null, { timeout: 15_000 }); // opened, focus on its heading
    await page.getByText(/^Your verdict was recorded against earlier marking, an earlier approved text or rubric, or other marks of yours/).waitFor({ timeout: 15_000 });
    await toComparison();
    await press("Change the verdict");
    await page.getByText("Recorded your verdict on sub-001: Generous.").waitFor({ timeout: 15_000 });
    await page.locator("#review-id").selectOption("sub-002");
    await press("Review this submission");
    await page.getByRole("heading", { name: "Reviewing sub-002 [STUDENT_B]" }).waitFor({ timeout: 15_000 });
    await toComparison();
    await page.getByRole("radio", { name: /^Agree/ }).focus();
    await page.keyboard.press("Space");
    await press("Record the verdict");
    await page.getByText("Recorded your verdict on sub-002: Agree.").waitFor({ timeout: 15_000 });
    await step("Original marking");
    await press("Check the marker marking of sub-002 [STUDENT_B]");
    await page.getByRole("heading", { name: "The marking of sub-002 (marker)" }).waitFor({ timeout: 15_000 });
    await press("Confirm this marking");
    await page.getByText("Confirmed the original marking of sub-002 (marker)").waitFor({ timeout: 15_000 });

    await step("Export");
    // The status line says it is ready, as the steps do, where a section of its own used to.
    const ready = (await page.locator(".step-line").innerText()) === "Not started: nothing approved yet; everything is ready for you to approve.";
    const previewed = await page.getByRole("heading", { name: "The summary, as it would be approved" }).waitFor({ timeout: 15_000 }).then(() => true, () => false); // read when the screen opens
    await page.locator("#overall-comment").fill("Marking was broadly consistent with the rubric.");
    await press("Approve the moderation record");
    await page.getByText(/^Approved the moderation record on /).waitFor({ timeout: 15_000 });
    const approvedKept = (await heading()) === "Approve the moderation record"; // focus stays on the button
    const approvedShown = (await page.locator("details > summary", { hasText: "The approved summary" }).count()) === 1; // folded away under what is recorded
    await audit("Export (approved, with the summary)");
    await press("Export the record and summary");
    await page.getByText("Wrote exports/app-check-record.feedbacker-export.json, exports/app-check-summary.feedbacker-export.md, exports/app-check-summary.feedbacker-export.docx, pseudonymous.").waitFor({ timeout: 15_000 });
    // The re-identified copy is confirmed each time: asking shows what it will contain, with focus on the question; declining makes nothing.
    await press("Make a re-identified copy");
    await page.waitForFunction(() => document.activeElement?.textContent === "Make a re-identified copy?", null, { timeout: 15_000 });
    const explained =
      (await page.getByText('beside the pseudonymous ones, with "-reidentified" in their names: the summary').count()) === 1 &&
      (await page.getByText("Turnitin ID in place of their pseudonym. They contain personal data").count()) === 1;
    await audit("Export (confirm the re-identified copy)");
    await press("Make the copy");
    await page.getByText(/^Wrote the re-identified copy: exports\/app-check-summary-reidentified\.feedbacker-export\.md, /).waitFor({ timeout: 15_000 });
    const backOnButton = (await heading()) === "Make a re-identified copy";
    await press("Make a re-identified copy");
    await page.waitForFunction(() => document.activeElement?.textContent === "Make a re-identified copy?", null, { timeout: 15_000 });
    await press("Don't make it");
    await page.getByText("No re-identified copy was made.").waitFor({ timeout: 15_000 });
    const askedAgain = explained && backOnButton && (await vanished(page.getByRole("heading", { name: "Make a re-identified copy?" }))) && (await heading()) === "Make a re-identified copy";
    const parts = { listed, notAnError, linked, ready, previewed, approvedKept, approvedShown, askedAgain };
    if (!Object.values(parts).every(Boolean)) appNotes.push(`export parts: ${JSON.stringify(parts)}`);
    return Object.values(parts).every(Boolean);
  });

  // Deleting the workspace: only with its name typed; then the folder is gone, the proxy has forgotten it, and the chooser says so.
  const deleteOk = await expectStep("delete", async () => {
    await page.locator("details.workspace-menu summary").focus();
    await page.keyboard.press("Enter"); // opens the workspace menu
    await press("Delete this workspace…");
    await page.waitForFunction(() => document.activeElement?.textContent === "Delete this workspace", null, { timeout: 15_000 });
    // The exports are listed with their full paths, the re-identified copies marked, before anything can be deleted.
    await page.locator(".export-list li").first().waitFor({ timeout: 15_000 });
    const listed = await page.locator(".export-list li").allInnerTexts();
    const exportsListed =
      listed.length === 5 &&
      listed.every((l) => l.startsWith("/Users/moderator/Feedbacker/workspaces/app-check/exports/")) &&
      listed.filter((l) => l.endsWith("(a re-identified copy: it contains personal data)")).length === 2;
    await page.locator("#confirm-name").fill("app-chec");
    await press("Delete this workspace permanently");
    await page.getByText("type the workspace's name, app-check, exactly, to confirm deleting it").waitFor({ timeout: 15_000 });
    // The right name alone isn't enough while there are exports: they must be ticked as kept.
    await page.locator("#confirm-name").fill("app-check");
    await press("Delete this workspace permanently");
    await page.getByText('tick "I have kept the exports I need" first: they are deleted with the workspace').waitFor({ timeout: 15_000 });
    const keptAfterTypo = await page.evaluate(async () => {
      for await (const name of (await navigator.storage.getDirectory()).keys()) if (name === "app-ws") return true;
      return false;
    });
    await audit("Delete this workspace (with the exports listed)");
    await page.getByRole("checkbox", { name: "I have kept the exports I need" }).check();
    await press("Delete this workspace permanently");
    await page.getByRole("heading", { name: "Your work" }).waitFor({ timeout: 15_000 });
    const chooserFocused = (await heading()) === "Your work";
    // Told in the status region, so it is announced as well as shown.
    await page.getByRole("status").filter({ hasText: /^Deleted the workspace app-check: its folder, \/Users\/moderator\/Feedbacker\/workspaces\/app-check, and everything in it/ }).waitFor({ timeout: 15_000 });
    const told = true;
    const gone = await page.evaluate(async () => {
      for await (const name of (await navigator.storage.getDirectory()).keys()) if (name === "app-ws") return false;
      return true;
    });
    const forgotten = (await page.evaluate(() => (window as unknown as { __forgotten?: string[] }).__forgotten))?.at(-1) === "ws-app";
    await page.getByRole("heading", { name: "mark-check" }).waitFor({ timeout: 15_000 }); // the list has been read again
    const unlisted = (await page.getByRole("heading", { name: "app-check" }).count()) === 0;
    await audit("Your work (after deleting)");
    const parts = { exportsListed, keptAfterTypo, chooserFocused, told, gone, forgotten, unlisted };
    if (!Object.values(parts).every(Boolean)) appNotes.push(`delete parts: ${JSON.stringify(parts)}`);
    return Object.values(parts).every(Boolean);
  });

  // A marking workspace: its type shown, its own steps, and its assessment recorded.
  const markingWorkspaceOk = await expectStep("marking workspace", async () => {
    await press("Continue mark-check");
    await page.getByRole("heading", { name: "Marking overview" }).waitFor({ timeout: 15_000 });
    const typed = (await page.locator(".workspace-head").innerText()).startsWith("Marking workspace mark-check");
    const steps = await page.getByRole("navigation", { name: "Marking steps" }).getByRole("button").allInnerTexts();
    const ownSteps = JSON.stringify(steps) === JSON.stringify(["Overview", "Details", "Rubric", "Brief", "Submissions", "Anonymisation", "AI proposals", "Marking", "Feedback", "Export"]);
    await audit("Marking overview");
    await press("Details");
    await page.getByRole("heading", { name: "The assessment" }).waitFor({ timeout: 15_000 });
    const notYet = (await page.locator(".step-line").innerText()) === "Not started: no assessment recorded yet.";
    await page.locator("#assessment-title").fill("Coursework 1: a web application");
    await page.locator("#assessment-module").fill("Fictional Module 101");
    await press("Record the assessment");
    await page.getByRole("heading", { name: "What's recorded" }).waitFor({ timeout: 15_000 });
    const recorded =
      (await page.locator(".step-line").innerText()) === "Done: Coursework 1: a web application." &&
      (await heading()) === "What's recorded" &&
      (await page.locator("details.step-form > summary").innerText()) === "Change the assessment";
    await audit("The assessment (recorded)");

    // The cohort: every submission in the download, and the file whose name carries no ID listed, not guessed at.
    await press("Submissions");
    await page.getByRole("heading", { name: "The cohort's submissions" }).waitFor({ timeout: 15_000 });
    const noCohort = (await page.locator(".step-line").innerText()) === "Not started: no submissions imported yet.";
    await page.locator("#cohort-files").setInputFiles({ name: "cohort_1.zip", mimeType: "application/zip", buffer: Buffer.from(cohortZip) });
    await press("Import the submissions");
    await page.getByText("Imported 2 submissions").waitFor({ timeout: 30_000 });
    const cohortRows = await page.getByRole("table", { name: /^Each submission in the cohort/ }).locator("tbody tr").allInnerTexts();
    const cohort =
      (await page.locator(".step-line").innerText()) === "Done: 2 submissions imported." &&
      (await status()).includes("1 download report was not opened") &&
      (await shown(page.getByText("These files weren't imported (the others were):"))) &&
      !/reading list|LARK/i.test(await page.locator("main").innerText()) && // no real name on the page; the real ID is in the table
      cohortRows.length === 2 &&
      cohortRows[0].startsWith("sub-001 [STUDENT_A]\t100200401\tImported") &&
      (await page.locator("details.step-form > summary").innerText()) === "Import more submissions";
    await audit("The cohort's submissions");

    // Anonymisation works from the cohort.
    await press("Anonymisation");
    await page.getByRole("heading", { name: "Anonymisation", level: 1 }).waitFor({ timeout: 15_000 });
    const toAnonymise = (await page.locator(".step-line").innerText()) === "Not started: 0 of 2 texts approved.";
    await press("Anonymise now");
    await page.getByText("Anonymised. sub-001:").waitFor({ timeout: 30_000 });
    const anonymised = (await page.getByRole("button", { name: "Review sub-002 [STUDENT_B]" }).count()) === 1;
    await audit("Anonymisation (marking)");
    await press("Review sub-001 [STUDENT_A]");
    await press("Approve this text for the AI");
    await page.getByText("Approved sub-001 [STUDENT_A]").waitFor({ timeout: 15_000 });
    // sub-002's report has charts: each is shown where it was in the text, under the policy's blob: images, and can be kept back.
    await press("Review sub-002 [STUDENT_B]");
    await page.getByRole("img", { name: "Figure [FIGURE_1], page 1, from the submission" }).waitFor({ timeout: 15_000 });
    const figuresShown =
      (await page.locator(".review-figure img").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).join() === "true,true,true" &&
      (await page.getByText("Redaction can't see inside an image.").count()) === 1;
    await audit("Anonymisation (figures)");
    await page.getByRole("checkbox", { name: "Don't send [FIGURE_2]" }).check();
    await page.getByText("[FIGURE_2] won't be sent.").waitFor({ timeout: 15_000 });
    await page.getByRole("textbox", { name: "Why not (optional)" }).fill("It shows a colleague's name");
    await page.getByRole("button", { name: "Save the reason for [FIGURE_2]" }).click();
    await page.getByText("Saved why [FIGURE_2] isn't sent.").waitFor({ timeout: 15_000 });
    const figureKept = (await page.locator(".review-figure.excluded figcaption").innerText()) === "[FIGURE_2], page 1 (not sent)";
    await audit("Anonymisation (a figure not sent)");
    await press("Approve this text and its figures for the AI");
    await page.getByText("Approved sub-002 [STUDENT_B]: exactly this text, and its 2 included figure(s), may be sent to the AI.").waitFor({ timeout: 15_000 });

    // Marking is locked until the rubric is saved; then the AI proposes levels (from the stand-in proxy).
    const marking = () => page.getByRole("navigation", { name: "Marking steps" });
    await marking().getByRole("button", { name: "Marking", exact: true }).click();
    const lockedFirst = (await page.getByText("Save the source rubric").count()) === 1;
    await marking().getByRole("button", { name: "Rubric", exact: true }).click();
    await page.locator("#rubric-file").setInputFiles(join(PACK, "rubric.csv"));
    await press("Read the rubric");
    await page.locator(".step-line").getByText("Done").waitFor({ timeout: 15_000 });
    const levelsDescribed = (await page.getByRole("table", { name: /^Each criterion, its weight and its levels/ }).innerText()).includes("9 levels, from FAIL (20) to 1ST (85)");
    await marking().getByRole("button", { name: "AI proposals", exact: true }).click();
    await page.getByRole("heading", { name: "AI proposals", level: 1 }).waitFor({ timeout: 15_000 });
    await page.getByRole("checkbox", { name: /brief/i }).uncheck().catch(() => {}); // there is no brief here
    await press("Plan the reading");
    await page.getByRole("heading", { name: "Check the estimate before anything is sent" }).waitFor({ timeout: 15_000 });
    // sub-002's approved figures go with it (the one kept back doesn't); sub-001 has none.
    const planRows = await page.getByRole("table", { name: /^What would be sent/ }).locator("tbody tr").allInnerTexts();
    const figuresPlanned = planRows.some((r) => r.startsWith("sub-001 [STUDENT_A]\tNone\t")) && planRows.some((r) => r.startsWith("sub-002 [STUDENT_B]\t2 sent, 1 not sent\t"));
    await audit("AI proposals (with figures)");
    await press("Confirm and send");
    await page.getByRole("heading", { name: "What came back" }).waitFor({ timeout: 30_000 });
    const proposed = (await page.locator("main").innerText()).includes("Open a submission on Marking to see its proposals.");
    await audit("AI proposals (results)");

    // Open marking: the proposals and the provisional mark are shown; the proposed level is taken in one action.
    await marking().getByRole("button", { name: "Marking", exact: true }).click();
    await page.getByRole("heading", { name: "Marking", level: 1 }).waitFor({ timeout: 15_000 });
    await press("Mark this submission");
    await page.getByRole("heading", { name: "Marking sub-001 [STUDENT_A]" }).waitFor({ timeout: 15_000 });
    await press("Show the proposals");
    await page.getByText("Proposals shown;").waitFor({ timeout: 15_000 });
    const provisionalShown = (await page.locator("p.provisional").first().innerText()).startsWith("No provisional mark: the AI proposed no level");
    await page.getByRole("button", { name: /^Take the proposed level/ }).first().focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: /^Start from the AI's draft comment/ }).first().focus();
    await page.keyboard.press("Enter");
    const drafted = (await page.locator("fieldset.judge textarea").first().inputValue()) === "Consider the brief." && (await page.evaluate(() => document.activeElement?.id ?? "")).startsWith("comment-"); // focus moves to the comment, to adapt it
    await audit("Marking (open)");
    const criteria = await page.getByRole("navigation", { name: "Criteria of sub-001" }).getByRole("button").count(); // and "Overall mark"
    for (let i = 0; i < criteria - 1; i++) {
      if (i > 0) await page.locator("fieldset.judge input[type=radio]").nth(2).check();
      await page.getByRole("button", { name: /^Record and go to the/ }).focus();
      await page.keyboard.press("Enter");
      await page.getByText(/^Recorded /).first().waitFor({ timeout: 15_000 });
    }
    const atOverall = (await heading()).startsWith("Overall mark: sub-001");
    const prefilled = (await page.locator("#overall-mark").inputValue()) !== "";
    await page.locator("#overall-comment").fill("A clear piece of work.");
    await press("Record the overall mark");
    await page.getByText("Recorded your overall mark for sub-001").waitFor({ timeout: 15_000 });
    // Each criterion and the overall mark say what was recorded, under their buttons.
    const statuses = (await page.locator("#cstate-overall").innerText()).startsWith("Recorded: ") && (await page.locator("nav.criteria-nav li > span").first().innerText()).startsWith("Marked: ");
    await page.getByRole("navigation", { name: "Criteria of sub-001" }).getByRole("button").first().click(); // the criterion whose proposal was taken
    await page.getByText("(the AI's proposed level); comment adapted from the AI's draft").waitFor({ timeout: 15_000 });
    const takenFromAi = true;
    await audit("Marking (overall)");

    // Blind marking of the next submission, in one action: nothing of the AI's shows until every level is recorded.
    await press("Next submission: sub-002 [STUDENT_B]");
    await page.getByRole("heading", { name: "Marking sub-002 [STUDENT_B]" }).waitFor({ timeout: 15_000 });
    await press("Mark blind");
    await page.getByText("Marking blind, proposals not yet revealed").waitFor({ timeout: 15_000 });
    const hidden = (await page.getByRole("heading", { name: /^AI proposal/ }).count()) === 0 && (await page.locator("p.provisional").count()) === 0;
    for (let i = 0; i < criteria - 1; i++) {
      await page.locator("fieldset.judge input[type=radio]").nth(3).check();
      await page.getByRole("button", { name: /^Record and go to the/ }).focus();
      await page.keyboard.press("Enter");
      await page.getByText(/^Recorded /).first().waitFor({ timeout: 15_000 });
    }
    await press("Reveal the AI's proposals");
    await page.getByText("Revealed the AI's proposals").waitFor({ timeout: 15_000 });
    const revealed = (await page.locator("p.provisional").count()) > 0;
    await audit("Marking (blind, revealed)");
    const markStatus = await page.locator(".step-line").innerText();

    // Feedback: drafted from the educator's marking (shown exactly as it will be sent), then adapted and recorded.
    // What the screen loads as it opens is answered late here, as on a slow computer: held until the guide has been typed and
    // saved, then released. What was typed, and then what was saved, must not be replaced when it arrives.
    type Late = { realGetDirectoryHandle: typeof FileSystemDirectoryHandle.prototype.getDirectoryHandle; opening: boolean; held: number; release: () => void };
    await page.evaluate(() => {
      const late = window as unknown as Late;
      const get = FileSystemDirectoryHandle.prototype.getDirectoryHandle;
      const gate = new Promise<void>((r) => (late.release = r));
      Object.assign(late, { realGetDirectoryHandle: get, opening: true, held: 0 });
      FileSystemDirectoryHandle.prototype.getDirectoryHandle = async function (name: string, options?: FileSystemGetDirectoryOptions) {
        const found = get.call(this, name, options); // looked up now, but answered late
        if (name === "feedback" && !options?.create && late.opening) {
          late.held++;
          await found.catch(() => undefined);
          await gate;
        }
        return found;
      };
    });
    await marking().getByRole("button", { name: "Feedback", exact: true }).click();
    await page.getByRole("heading", { name: "Feedback", level: 1 }).waitFor({ timeout: 15_000 });
    // A feedback guide: saved (anonymised, a new version), then approved, and so sent with every draft.
    await page.locator("#guide-text").fill("A 2:1 needs to hear that its requirements are clear. Next time, rank them.");
    await page.evaluate(() => Object.assign(window, { opening: false })); // the guide's load, begun as its panel opened, is held; saving isn't
    await press("Save the guide");
    await page.getByText(/^Saved version 1 of the guide, anonymised/).waitFor({ timeout: 15_000 });
    const lateLoadHeld = await page.evaluate(async () => {
      const late = window as unknown as Late;
      const held = late.held;
      FileSystemDirectoryHandle.prototype.getDirectoryHandle = late.realGetDirectoryHandle;
      late.release();
      await new Promise((r) => setTimeout(r)); // after every step the released loads take: they don't wait on anything else
      return held > 0;
    });
    await press("Approve this guide for the AI");
    await page.getByText("Version 1, approved: it is sent with every draft").waitFor({ timeout: 15_000 });
    await audit("Feedback (guide)");
    await press("Plan the drafts");
    await page.getByRole("heading", { name: "Check what will be sent" }).waitFor({ timeout: 15_000 });
    const planFocused = (await heading()) === "Check what will be sent";
    // sub-002 is marked blind with no overall mark yet: its criteria are drafted, and the summary is said to be left out.
    const guideInPlan = (await page.locator("main").innerText()).includes("with version 1 of your feedback guide (the same for every submission)");
    const shownAsSent =
      (await page.getByText(/^What will be sent of your marking of sub-00[12]/).count()) === 2 &&
      (await page.getByText("sub-002/overall: record the overall mark first").count()) === 1;
    if (!shownAsSent) appNotes.push(`feedback plan: ${(await page.locator("main").innerText()).slice(-1200).replace(/\n/g, " / ")}`);
    await audit("Feedback (plan)");
    await press("Confirm and send");
    await page.getByRole("heading", { name: "What came back" }).waitFor({ timeout: 30_000 });
    const draftedFor = (await page.locator("main").innerText()).includes("Drafted for 2 submission(s)");
    if (!draftedFor) appNotes.push(`feedback result: ${(await page.locator("main").innerText()).slice(-900).replace(/\n/g, " / ")}`);
    await press("Write this submission's feedback");
    await page.getByRole("heading", { name: "Feedback for sub-001 [STUDENT_A]" }).waitFor({ timeout: 15_000 });
    // Each box starts from its draft, but nothing is saved until it is recorded.
    const startedFromDraft =
      (await page.locator("fieldset.judge textarea").first().inputValue()).startsWith("You set this out clearly.") &&
      (await page.getByText(/^Not yet recorded: the AI's draft is in the box/).count()) > 0;
    await page.getByRole("button", { name: /^Record the feedback/ }).first().focus();
    await page.keyboard.press("Enter");
    await page.getByText(/^Recorded the feedback on .+, adapted from the AI's draft\.$/).waitFor({ timeout: 15_000 });
    // A change after recording is said to be unsaved, never shown as recorded.
    await page.locator("fieldset.judge textarea").first().fill("A changed draft. Next time, go further.");
    const unsavedShown = (await page.getByText("Changed, not yet recorded: record it to keep your changes").count()) === 1;
    // The second criterion was marked in the 2:1 range: "excellent" is flagged, and is kept by accepting it with a reason.
    await page.locator("fieldset.judge textarea").nth(1).fill("Excellent work. Next time, go further.");
    await page.getByRole("button", { name: /^Record the feedback/ }).nth(1).focus();
    await page.keyboard.press("Enter");
    await page.getByText(/^Check: "Excellent" is praise for first-class/).waitFor({ timeout: 15_000 });
    await page.getByText("Recorded the feedback on Implementation, adapted from the AI's draft.").waitFor({ timeout: 15_000 }); // recording has finished
    const flagged = (await page.getByText(/flags? to check in this submission's feedback/).count()) === 1;
    const draftAgainOffered =
      (await page.getByRole("button", { name: /^Draft this again, avoiding "excellent"/i }).count()) === 1 &&
      (await page.getByRole("button", { name: /^Draft this again\s*: / }).count()) >= 5; // on every criterion and the overall, even with a current draft
    const quickReasons = (await page.getByRole("button", { name: /^Accept: Not praise here: it says what is missing/ }).count()) === 1;
    await audit("Feedback (a flag)");
    // A suggested edit for the flag: what will be sent is shown first (the feedback and its flag, no submission), then the suggestion beside the feedback.
    await page.getByRole("button", { name: /^Suggest an edit for this flag\s*: Implementation$/ }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Check what will be sent to suggest an edit" }).waitFor({ timeout: 15_000 });
    const suggestPlanned =
      (await heading()) === "Check what will be sent to suggest an edit" &&
      (await page.getByLabel("Your feedback on Implementation and its flags, as they will be sent").innerText()).startsWith("Excellent work. Next time, go further.\n\nWhat Feedbacker's checks flagged in it:");
    await audit("Feedback (suggestion planned)");
    await page.getByRole("button", { name: /^Confirm and send\s*: suggest an edit to Implementation$/ }).focus();
    await page.keyboard.press("Enter");
    await page.getByText(/^The AI suggested an edit/).waitFor({ timeout: 15_000 });
    const suggestionShown =
      (await heading()) === "The AI's suggested edit" &&
      /Clear work\. Next time, go further\.\s+No flags on the suggested edit\./.test(await page.getByRole("group", { name: "The AI's suggested edit" }).innerText()) &&
      (await page.locator("fieldset.judge textarea").nth(1).inputValue()) === "Excellent work. Next time, go further."; // the feedback is unchanged
    if (!suggestionShown) appNotes.push(`suggestion: focus "${await heading()}"; ${(await page.locator("main").innerText()).slice(-1500).replace(/\n/g, " / ")}`);
    await audit("Feedback (suggested edit)");
    await page.getByRole("button", { name: /^Don't use it/ }).click(); // kept as it is, below, by accepting the flag
    // The cohort's feedback, side by side by level, each with a way back to editing it.
    await page.locator("summary").filter({ hasText: /^Implementation/ }).click();
    const cohortShown = (await page.getByRole("table", { name: /^Implementation: each student's feedback, grouped by your level/ }).count()) === 1;
    await audit("Feedback (across the cohort)");
    // From the reason box, Tab to the button and press Enter, as at the keyboard.
    await page.getByRole("textbox", { name: "Reason for keeping it" }).first().fill("The brief asks for this exact word");
    await page.keyboard.press("Tab");
    const onAccept = (await heading()).startsWith("Accept with this reason");
    await page.keyboard.press("Enter");
    await page.getByText(/Accepted: "Excellent" is praise .+ Your reason: The brief asks for this exact word/).waitFor({ timeout: 15_000 });
    await page.getByText("Accepted the flag on Implementation, with your reason.").waitFor({ timeout: 15_000 }); // accepting has finished
    const accepted = (await page.getByRole("table", { name: /^Each submission's recorded feedback, and its flags/ }).innerText()).includes("sub-001 [STUDENT_A]\t2\t0\t1");
    await audit("Feedback (writing)");

    // The rest of sub-001's feedback, recorded as it stands (the first box holds the changed draft from above).
    for (const title of ["Requirements and design", "Testing and evaluation", "Reflection and professional practice", "Overall"]) {
      await page.getByRole("button", { name: `Record the feedback on ${title}`, exact: true }).focus();
      await page.keyboard.press("Enter");
      await page.getByText(new RegExp(`^Recorded the feedback on ${title === "Overall" ? "the overall summary" : title}`)).waitFor({ timeout: 15_000 });
    }

    // Drafting a recorded criterion again from its row: its box held the old draft unchanged, so the new draft takes its
    // place (saved only when recorded), and focus comes back to that box.
    await page.getByRole("button", { name: /^Draft this again\s*: Testing and evaluation$/ }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Check what will be sent" }).waitFor({ timeout: 15_000 });
    await press("Confirm and send");
    await page.getByText("Drafted Testing and evaluation again: the new draft is in the box. Read it, change it as you need to, and record it.").waitFor({ timeout: 30_000 });
    const backInBox = (await page.evaluate(() => document.activeElement?.id ?? "")) === "feedback-testing-and-evaluation";
    const newDraftUnrecorded = (await page.getByText(/^Not yet recorded: the AI's new draft is in the box/).count()) === 1;
    // Its checks are of the new text in the box, not the old recorded text.
    const liveChecks = (await page.getByText("No flags on the text in the box. Record it to keep it.").count()) === 1;
    await audit("Feedback (drafted again)");
    await page.getByRole("button", { name: "Record the feedback on Testing and evaluation", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByText(/^Recorded the feedback on Testing and evaluation/).waitFor({ timeout: 15_000 });

    // Export: read exactly what the student receives, approve it, copy it, and export.
    await marking().getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("heading", { name: "Export", level: 1 }).waitFor({ timeout: 15_000 });
    await page.getByRole("button", { name: /^Read what they receive\s*: sub-001 \[STUDENT_A\]$/ }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "What sub-001 [STUDENT_A] will receive" }).waitFor({ timeout: 15_000 });
    const receiveFocused = (await heading()) === "What sub-001 [STUDENT_A] will receive";
    const readyShown = (await page.getByText("Ready to approve").count()) > 0;
    await audit("Export (what a student receives)");
    await press("Approve exactly this");
    await page.getByText(/^Approved sub-001: exactly what is shown is what its student receives/).waitFor({ timeout: 15_000 });
    await press("Copy all the feedback");
    // Copying is asynchronous: whether it worked (or why not) is said once the clipboard has answered.
    const copiedSaid = await page
      .getByText(/^(Copied all the feedback to the clipboard|Couldn't copy all the feedback)/)
      .waitFor({ timeout: 15_000 })
      .then(() => true, () => false);
    await press("Export the approved feedback and marks");
    await page.getByText(/^Exported 1 approved submission\(s\)/).waitFor({ timeout: 15_000 });
    await press("Make a re-identified copy");
    await page.getByRole("heading", { name: "Make a re-identified copy?" }).waitFor({ timeout: 15_000 });
    const askedFirst = (await heading()) === "Make a re-identified copy?";
    await audit("Export (re-identified copy, asked first)");
    await press("Make the copy");
    await page.getByText(/^Wrote the re-identified copy: .+-marks-reidentified\.feedbacker-export\.csv/).waitFor({ timeout: 15_000 });
    await audit("Export (approved and exported)");
    const parts = { lateLoadHeld, typed, ownSteps, notYet, recorded, noCohort, cohort, toAnonymise, anonymised, figuresShown, figureKept, figuresPlanned, lockedFirst, levelsDescribed, proposed, provisionalShown, drafted, atOverall, prefilled, statuses, takenFromAi, hidden, revealed, planFocused, shownAsSent, draftedFor, startedFromDraft, unsavedShown, flagged, onAccept, accepted, guideInPlan, cohortShown, draftAgainOffered, quickReasons, suggestPlanned, suggestionShown, backInBox, newDraftUnrecorded, liveChecks, receiveFocused, readyShown, copiedSaid, askedFirst };
    if (!markStatus.startsWith("Needs attention: 1 of 2 submissions marked")) appNotes.push(`marking status: ${markStatus}`);
    if (!Object.values(parts).every(Boolean)) appNotes.push(`marking workspace parts: ${JSON.stringify({ ...parts, steps, cohortRows })}`);
    return Object.values(parts).every(Boolean);
  });

  const focusOk = unfocused.length === 0;
  const appOk = chooserFocused && emptyOk && requestOk && originalsOk && rubricOk && briefOk && anonymisedOk && nothingOk && reviewOk && markingOk && readingOk && lateRuleOk && batchOk && lockedOk && judgedOk && blindOk && overviewOk && exportOk && deleteOk && markingWorkspaceOk && focusOk;
  if (!appOk) failures++;
  console.log(`${appOk ? "PASS" : "FAIL"} the app sets up a moderation from the keyboard: request, originals, a previewed grid rubric, the brief, anonymisation with review (real values only on request) and approval, the original marking (import, check, confirm, enter by hand) and the AI reading (plan, confirm, send), refused for a text a later rule covers until it is anonymised and approved again, and read again as a batch (sent, left, checked and collected); then reviews one submission openly, records a judgement, adapts the AI draft into its comment, compares it and records a verdict, and another blind (hidden until every criterion is judged, then revealed and revised); the overview shows each step and the agreement across the sample; then the moderation is completed, approved and exported, with a re-identified copy on confirmation; and finally the workspace is deleted, only once its exports are listed and ticked as kept and its name is typed; focus moves to each step's heading`);
  if (!appOk) console.log(`    agreement: ${JSON.stringify(agreed)} ${JSON.stringify(byCriterion)}`);
  if (!appOk) console.log(`    steps: ${JSON.stringify({ chooserFocused, emptyOk, requestOk, originalsOk, rubricOk, briefOk, anonymisedOk, nothingOk, reviewOk, markingOk, readingOk, lateRuleOk, batchOk, lockedOk, judgedOk, blindOk, overviewOk, exportOk, deleteOk, unfocused })}\n    ${appNotes.join("\n    ")}\n    rows: ${JSON.stringify(rows)}`);

  // If the proxy stops answering after a screen has rendered, focus moves to the error's heading.
  await page.goto(`http://127.0.0.1:${port}/app.html?health=fail`);
  await page.getByRole("heading", { name: "The proxy can't be reached" }).waitFor({ timeout: 15_000 });
  const errorFocused = (await heading()) === "The proxy can't be reached";
  if (!errorFocused) failures++;
  console.log(`${errorFocused ? "PASS" : "FAIL"} if the proxy stops answering, focus moves to the error screen's heading`);
  await audit("Proxy error");

  // WCAG 2.2 AA, as far as it can be measured, on every screen above.
  const a11yOk = a11y.length === 0;
  if (!a11yOk) failures++;
  console.log(`${a11yOk ? "PASS" : "FAIL"} every screen meets the measured WCAG 2.2 AA checks (headings, names, contrast, target size, keyboard and focus, reflow at 320 px, text spacing)`);
  for (const issue of a11y) console.log(`    ${issue}`);

  // The built app, served by the real proxy (its own process, no key), from the address it prints.
  execFileSync("npx", ["vite", "build", "--logLevel", "error"], { cwd: here, stdio: "inherit" });
  const proxyData = mkdtempSync(join(tmpdir(), "feedbacker-proxy-"));
  const proxyProcess = spawn(process.execPath, ["src/main.ts", "--port", "0", "--app", join(here, "dist"), "--data", proxyData, "--workspaces", join(proxyData, "workspaces")], {
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
    const realOk = csp === CSP && !page.url().includes("token") && (await shown(page.getByRole("heading", { name: "Your work" })));
    if (!realOk) failures++;
    console.log(`${realOk ? "PASS" : "FAIL"} the real proxy serves the built app under its CSP; the app takes the session token from the address, removes it, and reaches the proxy`);
    // The version is shown, and the app and the proxy agree on it (they are built from the same commit here).
    const versionOk = (await page.locator(".app-footer").innerText()).includes(`Feedbacker ${VERSION}.`) && !(await page.getByText(/^The proxy is version /).count());
    if (!versionOk) failures++;
    console.log(`${versionOk ? "PASS" : "FAIL"} the app shows its version (${VERSION}), the same as the proxy's`);
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
