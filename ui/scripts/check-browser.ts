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
import { auditScreen } from "./a11y-audit.ts";
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
  const a11y: string[] = [];
  const audit = async (screen: string) => void a11y.push(...(await auditScreen(page, screen)));
  await audit("Workspace chooser");
  await press("Choose a workspace folder…");
  await page.getByRole("heading", { name: "Moderation overview" }).waitFor({ timeout: 15_000 });
  const emptyOk = (await page.getByText("No moderation request has been recorded yet.").isVisible()) && (await heading()) === "Moderation overview";
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
    return rowFocused;
  });

  await audit("Request");
  await step("Originals");
  await page.locator("#originals").setInputFiles({ name: "sample.zip", mimeType: "application/zip", buffer: Buffer.from(sampleZip) });
  await press("Import the originals");
  const originalsOk = await expectStep("originals", async () => {
    await page.getByText("Imported 2 of the sampled originals").waitFor({ timeout: 30_000 });
    return (await status()).includes("1 other file(s) in the download were not opened");
  });

  await audit("Originals");
  await step("Rubric");
  await page.locator("#rubric-file").setInputFiles(join(PACK, "rubric-grid.xlsx"));
  await press("Read the rubric");
  const rubricOk = await expectStep("rubric", async () => {
    await page.getByRole("heading", { name: "Check the rubric before saving it" }).waitFor({ timeout: 15_000 });
    const previewFocused = (await heading()) === "Check the rubric before saving it";
    const labelsShown = await page.getByRole("rowheader", { name: "Exceptional (100)" }).first().isVisible();
    // The grid gives no weights: one is entered per criterion, by its title, and the total is kept up to date.
    const boxes = page.getByRole("group", { name: "Criterion weights" }).getByRole("textbox");
    const n = await boxes.count();
    for (let i = 0; i < n; i++) await boxes.nth(i).fill(String(100 / n));
    const totalled = await page.getByText("Total: 100%").isVisible();
    // A mistyped weight is refused beside the Save button; the preview stays open with everything entered, to correct in place.
    await boxes.nth(0).fill("inf");
    const untotalled = await page.getByText("Total: a weight isn't a number yet.").isVisible();
    await press("Save this rubric");
    await page.getByText("The rubric wasn't saved:").waitFor({ timeout: 15_000 });
    const kept = (await boxes.count()) === n && (await boxes.nth(n - 1).inputValue()) === String(100 / n);
    await boxes.nth(0).fill(String(100 / n));
    await audit("Rubric (preview)");
    await press("Save this rubric");
    await page.getByText("Saved the rubric").waitFor({ timeout: 15_000 });
    const savedFocused = (await heading()) === "Source rubric"; // the preview closed, so focus moved to the heading
    const weighted = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("app-ws");
      const rubric = JSON.parse(await (await (await dir.getFileHandle("rubric.json")).getFile()).text());
      return rubric.criteria.every((c: { weight: number | null }) => c.weight !== null);
    });
    if (!(n > 0 && totalled && untotalled && kept && weighted)) appNotes.push(`rubric weights: ${JSON.stringify({ n, totalled, untotalled, kept, weighted })}`);
    return previewFocused && labelsShown && savedFocused && n > 0 && totalled && untotalled && kept && weighted;
  });

  await step("Brief");
  await page.locator("#brief-file").setInputFiles(join(PACK, "brief.docx"));
  await press("Import the brief");
  const briefOk = await expectStep("brief", async () => {
    await page.getByText("Imported the brief").waitFor({ timeout: 15_000 });
    return true;
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
    await audit("Anonymisation (review, real values shown)");
    await press("Approve this text for the AI reading");
    await page.getByText("Approved sub-001 [STUDENT_A]: exactly this text").waitFor({ timeout: 15_000 });
    const approvedKept = (await heading()) === "Approved"; // focus stays on the button, now done
    await press("Review The brief");
    await page.getByRole("heading", { name: "Review The brief" }).waitFor({ timeout: 15_000 });
    const briefHidden = !(await page.locator("main").innerText()).includes("Morgan Ellis");
    await press("Approve this text for the AI reading");
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
    const matched = (await match.count()) === 0; // matched, so no longer offered
    await press("Check the marker marking of sub-001 [STUDENT_A]");
    await page.getByRole("heading", { name: "The marking of sub-001 (marker)" }).waitFor({ timeout: 15_000 });
    const focused = (await heading()) === "The marking of sub-001 (marker)";
    const summary = await page.locator("pre.text").innerText();
    await audit("Original marking (check)");
    await press("Confirm this marking");
    await page.getByText("Confirmed the original marking of sub-001 (marker)").waitFor({ timeout: 15_000 });
    const confirmedKept = (await heading()) === "Confirmed"; // focus stays on the button, now done
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
    return matched && listed && focused && confirmedKept && importedKept && summary.includes("NOT CONFIRMED") && summary.includes("between");
  });

  await step("AI reading");
  const readingOk = await expectStep("reading", async () => {
    await press("Plan the reading");
    await page.getByRole("heading", { name: "Check the estimate before anything is sent" }).waitFor({ timeout: 15_000 });
    const planFocused = (await heading()) === "Check the estimate before anything is sent";
    const planned = await page.locator("main table").last().innerText();
    await audit("AI reading (plan)");
    const skippedShown = (await page.getByText("sub-002: sub-002 has not been approved by the moderator").count()) > 0;
    await press("Confirm and send");
    await page.getByRole("heading", { name: "What came back" }).waitFor({ timeout: 30_000 });
    const resultFocused = (await heading()) === "What came back";
    const came = await page.locator("main").innerText();
    await audit("AI reading (results)");
    return planFocused && planned.includes("sub-001") && !planned.includes("sub-002") && skippedShown && resultFocused && came.includes("sub-001: read");
  });

  // A rule added after approval (#83): nothing of the text it now covers is sent until it is anonymised and approved again.
  await step("Anonymisation");
  const lateRuleOk = await expectStep("late rule", async () => {
    await page.locator("#rule-redact-0-text").fill("risky"); // a word in sub-001's text
    await page.locator("#rule-redact-0-kind").selectOption("PROJECT");
    await press("Add to the rules");
    await page.getByText("Added to the rules").waitFor({ timeout: 15_000 });
    await step("AI reading");
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
    await press("Approve this text for the AI reading");
    await page.getByText("Approved sub-001 [STUDENT_A]").waitFor({ timeout: 15_000 });
    await step("AI reading");
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

  // A batch (#25): sent, waited for, checked and collected from the keyboard; the waiting section survives leaving the screen.
  const batchOk = await expectStep("batch", async () => {
    await step("AI reading");
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
    await audit("AI reading (batch waiting)");
    await step("Overview");
    await step("AI reading");
    await page.getByText(/Still in progress|It has finished/).waitFor({ timeout: 15_000 });
    const kept = (await page.getByRole("heading", { name: "Waiting for a batch" }).count()) === 1;
    if ((await page.getByRole("button", { name: "Check now", exact: true }).count()) > 0) {
      await press("Check now");
      await page.getByRole("button", { name: "Collect the results", exact: true }).waitFor({ timeout: 15_000 });
    }
    await press("Collect the results");
    await page.getByRole("heading", { name: "What came back" }).waitFor({ timeout: 30_000 });
    const collected = (await heading()) === "What came back" && (await page.locator("main").innerText()).includes("sub-001: read");
    const gone = (await page.getByRole("heading", { name: "Waiting for a batch" }).count()) === 0;
    const parts = { priced, waitingFocused, kept, collected, gone };
    if (!Object.values(parts).every(Boolean)) appNotes.push(`batch parts: ${JSON.stringify(parts)}`);
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
    // The comparison: the judged criterion beside both markers and the AI, with differences in words.
    const named = (await page.getByRole("heading", { name: "Comparison: sub-001 [STUDENT_A]" }).count()) === 1;
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
    await audit("Review (open, judged, verdict)");
    const parts = { choiceFirst, focused, together, stayed, recorded, derived, compared, verdictStayed, verdictShown };
    if (!Object.values(parts).every(Boolean)) appNotes.push(`judgement parts: ${JSON.stringify(parts)}`);
    return Object.values(parts).every(Boolean);
  });

  // Blind review of sub-002: approve its text, choose blind, and nothing of the marking or the reading shows until the reveal.
  await step("Anonymisation");
  const blindOk = await expectStep("blind review", async () => {
    await press("Review sub-002 [STUDENT_B]");
    await page.getByRole("heading", { name: "Review sub-002 [STUDENT_B]" }).waitFor({ timeout: 15_000 });
    await press("Approve this text for the AI reading");
    await page.getByText("Approved sub-002 [STUDENT_B]").waitFor({ timeout: 15_000 });
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
    const sets = page.locator("fieldset.judge");
    const count = await sets.count();
    for (let i = 0; i < count; i++) {
      await sets.nth(i).getByRole("radio").first().focus();
      await page.keyboard.press("Space");
      await sets.nth(i).getByRole("button", { name: /^Record the judgement of / }).focus();
      await page.keyboard.press("Enter");
      await page.getByText(/^Recorded your judgement of /).waitFor({ timeout: 15_000 });
      await page.getByText(`${i + 1} of 4 criteria judged`).waitFor({ timeout: 15_000 });
    }
    const stillHidden = !(await page.locator("main").innerText()).includes("marker's marking overall");
    await press("Reveal the original marking and the AI reading");
    await page.getByText("Revealed the original marking and the AI reading.").waitFor({ timeout: 15_000 });
    const revealFocused = (await heading()) === "Reviewing sub-002 [STUDENT_B]";
    const after = await page.locator("main").innerText();
    const shownAfter = after.includes("The marker's marking overall") && after.includes("marker:");
    const first = sets.first();
    await first.getByRole("radio").nth(1).focus();
    await page.keyboard.press("Space");
    await first.getByRole("button", { name: /^Record a revision of / }).focus();
    await page.keyboard.press("Enter");
    await page.getByText(/^Recorded your revision of /).waitFor({ timeout: 15_000 });
    const bothKept = (await first.locator("xpath=..").innerText()).includes("revised after the reveal to");
    const revisedCompared = (await page.getByRole("region", { name: "Comparison table" }).innerText()).includes("(revised from ");
    await audit("Review (blind, revealed and revised)");
    const parts = { blindFocused, hiddenBefore, checkWithheld, stillHidden, revealFocused, shownAfter, bothKept, revisedCompared };
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
  // Export (#20): not ready while anything is left to do; then the moderation is completed, approved and exported from the keyboard.
  await step("Export");
  const exportOk = await expectStep("export", async () => {
    await page.getByText("Not ready to approve yet:").waitFor({ timeout: 15_000 });
    const listed = (await page.getByText(/^sub-001 \[STUDENT_A\]: still to judge: /).count()) === 1;
    await audit("Export (not ready)");
    // Approving too soon isn't an error: it says nothing was approved, and why is in the note.
    await press("Approve the moderation record");
    await page.getByText('Nothing was approved: the moderation isn\'t ready yet. "Ready to approve?" lists what is left to do.').waitFor({ timeout: 15_000 });
    const notAnError = (await page.getByText("This couldn't be done:").count()) === 0;
    // Complete the moderation: sub-001's other criteria, sub-002's verdict, and its marking confirmed after the reveal.
    await step("Review");
    await press("Review this submission");
    await page.getByRole("heading", { name: "Reviewing sub-001 [STUDENT_A]" }).waitFor({ timeout: 15_000 });
    const sets = page.locator("fieldset.judge");
    for (let i = 1; i < 4; i++) {
      await sets.nth(i).getByRole("radio").first().focus();
      await page.keyboard.press("Space");
      await sets.nth(i).getByRole("button", { name: /^Record the judgement of / }).focus();
      await page.keyboard.press("Enter");
      await page.getByText(/^Recorded your judgement of /).waitFor({ timeout: 15_000 });
    }
    // The verdict was given before these marks, so it is flagged; given again, it is current.
    await press("Review this submission");
    await page.waitForFunction(() => document.activeElement?.textContent === "Reviewing sub-001 [STUDENT_A]", null, { timeout: 15_000 }); // opened, focus on its heading
    await page.getByText(/^Your verdict was recorded against earlier marking, an earlier approved text or rubric, or other marks of yours/).waitFor({ timeout: 15_000 });
    await press("Change the verdict");
    await page.getByText("Recorded your verdict on sub-001: Generous.").waitFor({ timeout: 15_000 });
    await page.locator("#review-id").selectOption("sub-002");
    await press("Review this submission");
    await page.getByRole("heading", { name: "Reviewing sub-002 [STUDENT_B]" }).waitFor({ timeout: 15_000 });
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
    await page.getByText("Yes: every sampled submission is approved").waitFor({ timeout: 15_000 });
    const previewed = (await page.getByRole("heading", { name: "The summary, as it would be approved" }).count()) === 1;
    await page.locator("#overall-comment").fill("Marking was broadly consistent with the rubric.");
    await press("Approve the moderation record");
    await page.getByText(/^Approved the moderation record on /).waitFor({ timeout: 15_000 });
    const approvedKept = (await heading()) === "Approve the moderation record"; // focus stays on the button
    const approvedShown = (await page.getByRole("heading", { name: "The approved summary" }).count()) === 1;
    await audit("Export (approved, with the summary)");
    await press("Export the record and summary");
    await page.getByText("Wrote exports/app-check-record.feedbacker-export.json, exports/app-check-summary.feedbacker-export.md, exports/app-check-summary.feedbacker-export.docx.").waitFor({ timeout: 15_000 });
    // The re-identified copy is confirmed each time: asking shows what it will contain, with focus on the question; declining makes nothing.
    await press("Make a re-identified copy");
    await page.waitForFunction(() => document.activeElement?.textContent === "Make a re-identified copy?", null, { timeout: 15_000 });
    const explained = (await page.getByText("It will contain personal data: each student's Turnitin ID, which identifies them.").count()) === 1;
    await audit("Export (confirm the re-identified copy)");
    await press("Make the copy");
    await page.getByText(/^Wrote the re-identified copy: exports\/app-check-summary-reidentified\.feedbacker-export\.md, /).waitFor({ timeout: 15_000 });
    const backOnButton = (await heading()) === "Make a re-identified copy";
    await press("Make a re-identified copy");
    await page.waitForFunction(() => document.activeElement?.textContent === "Make a re-identified copy?", null, { timeout: 15_000 });
    await press("Don't make it");
    await page.getByText("No re-identified copy was made.").waitFor({ timeout: 15_000 });
    const askedAgain = explained && backOnButton && (await page.getByRole("heading", { name: "Make a re-identified copy?" }).count()) === 0 && (await heading()) === "Make a re-identified copy";
    const parts = { listed, notAnError, previewed, approvedKept, approvedShown, askedAgain };
    if (!Object.values(parts).every(Boolean)) appNotes.push(`export parts: ${JSON.stringify(parts)}`);
    return Object.values(parts).every(Boolean);
  });

  // Deleting the workspace (#85): only with its name typed; then the folder is gone, the proxy has forgotten it, and the chooser says so.
  await step("Overview");
  const deleteOk = await expectStep("delete", async () => {
    await page.getByText("Delete this workspace", { exact: true }).focus();
    await page.keyboard.press("Enter"); // opens the section
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
    await audit("Overview (delete, with the exports listed)");
    await page.getByRole("checkbox", { name: "I have kept the exports I need" }).check();
    await press("Delete this workspace permanently");
    await page.getByRole("heading", { name: "Open a workspace" }).waitFor({ timeout: 15_000 });
    const chooserFocused = (await heading()) === "Open a workspace";
    // Told in the status region, so it is announced as well as shown.
    await page.getByRole("status").filter({ hasText: /^Deleted the workspace app-check: its folder, \/Users\/moderator\/Feedbacker\/workspaces\/app-check, and everything in it/ }).waitFor({ timeout: 15_000 });
    const told = true;
    const gone = await page.evaluate(async () => {
      for await (const name of (await navigator.storage.getDirectory()).keys()) if (name === "app-ws") return false;
      return true;
    });
    const forgotten = JSON.stringify(await page.evaluate(() => (window as unknown as { __forgotten?: string[] }).__forgotten)) === JSON.stringify(["ws-app"]);
    await audit("Workspace chooser (after deleting)");
    const parts = { exportsListed, keptAfterTypo, chooserFocused, told, gone, forgotten };
    if (!Object.values(parts).every(Boolean)) appNotes.push(`delete parts: ${JSON.stringify(parts)}`);
    return Object.values(parts).every(Boolean);
  });

  const focusOk = unfocused.length === 0;
  const appOk = chooserFocused && emptyOk && requestOk && originalsOk && rubricOk && briefOk && anonymisedOk && nothingOk && reviewOk && markingOk && readingOk && lateRuleOk && batchOk && judgedOk && blindOk && overviewOk && exportOk && deleteOk && focusOk;
  if (!appOk) failures++;
  console.log(`${appOk ? "PASS" : "FAIL"} the app sets up a moderation from the keyboard: request, originals, a previewed grid rubric, the brief, anonymisation with review (real values only on request) and approval, the original marking (import, check, confirm, enter by hand) and the AI reading (plan, confirm, send), refused for a text a later rule covers until it is anonymised and approved again, and read again as a batch (sent, left, checked and collected); then reviews one submission openly, records a judgement, adapts the AI draft into its comment, compares it and records a verdict, and another blind (hidden until every criterion is judged, then revealed and revised); the overview shows each step and the agreement across the sample; then the moderation is completed, approved and exported, with a re-identified copy on confirmation; and finally the workspace is deleted, only once its exports are listed and ticked as kept and its name is typed; focus moves to each step's heading`);
  if (!appOk) console.log(`    agreement: ${JSON.stringify(agreed)} ${JSON.stringify(byCriterion)}`);
  if (!appOk) console.log(`    steps: ${JSON.stringify({ chooserFocused, emptyOk, requestOk, originalsOk, rubricOk, briefOk, anonymisedOk, nothingOk, reviewOk, markingOk, readingOk, lateRuleOk, batchOk, judgedOk, blindOk, overviewOk, exportOk, deleteOk, unfocused })}\n    ${appNotes.join("\n    ")}\n    rows: ${JSON.stringify(rows)}`);

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
