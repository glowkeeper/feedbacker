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
  await page.locator("#sample").fill("60-69:100200301\n100200303");
  await page.locator("#module").fill("Fictional Module 101");
  await press("Record the request");
  const requestOk = await expectStep("request", async () => {
    await page.getByText("Recorded the request: 2 sampled submissions").waitFor({ timeout: 15_000 });
    return true;
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
    await audit("Rubric (preview)");
    await press("Save this rubric");
    await page.getByText("Saved the rubric").waitFor({ timeout: 15_000 });
    const savedFocused = (await heading()) === "Source rubric"; // the preview closed, so focus moved to the heading
    return previewFocused && labelsShown && savedFocused;
  });

  await step("Brief");
  await page.locator("#brief-file").setInputFiles(join(PACK, "brief.docx"));
  await press("Import the brief");
  const briefOk = await expectStep("brief", async () => {
    await page.getByText("Imported the brief").waitFor({ timeout: 15_000 });
    return true;
  });

  await audit("Brief");
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
  await page.locator("#views").setInputFiles({ name: "views.zip", mimeType: "application/zip", buffer: Buffer.from(viewsZip) });
  await page.locator("#mapping").fill("PROFESSIONALISM=reflection-and-professional-practice");
  await press("Import the marking");
  const markingOk = await expectStep("marking", async () => {
    await page.getByText("Imported the marking for 2 sampled submission(s)").waitFor({ timeout: 30_000 });
    await press("Check the marker marking of sub-001 [STUDENT_A]");
    await page.getByRole("heading", { name: "The marking of sub-001 (marker)" }).waitFor({ timeout: 15_000 });
    const focused = (await heading()) === "The marking of sub-001 (marker)";
    const summary = await page.locator("pre.text").innerText();
    await audit("Original marking (check)");
    await press("Confirm this marking");
    await page.getByText("Confirmed the original marking of sub-001 (marker)").waitFor({ timeout: 15_000 });
    const confirmedKept = (await heading()) === "Confirmed"; // focus stays on the button, now done
    // A second marker's record, entered by hand, is listed beside the imported one.
    // (sub-002's marking is left unconfirmed, so it can be reviewed blind below.)
    await page.locator("#entry-id").selectOption("sub-001");
    await page.locator("#entry-marker").fill("second marker");
    await page.locator("#entry-overall").fill("58");
    await page.locator("#entry-points").fill("implementation=58");
    await press("Enter the marking");
    await page.getByText("Entered the marking of sub-001 (second marker)").waitFor({ timeout: 15_000 });
    const listed = (await page.getByRole("button", { name: "Check the second marker marking of sub-001 [STUDENT_A]" }).count()) === 1;
    if (!confirmedKept) appNotes.push("marking: focus left the confirm button");
    return listed && focused && confirmedKept && summary.includes("NOT CONFIRMED") && summary.includes("between");
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
    await first.getByRole("radio").nth(1).focus();
    await page.keyboard.press("Space");
    // The comment starts from the AI draft and is adapted from the keyboard; it is recorded as derived from the draft.
    await page.getByRole("button", { name: /^Start from the AI draft for / }).first().focus();
    await page.keyboard.press("Enter");
    const toComment = await page.evaluate(() => (document.activeElement as HTMLTextAreaElement | null)?.value ?? "");
    await page.keyboard.press("End");
    await page.keyboard.type(" The design is clear.");
    const adapting = (await first.getByText("Adapted from the AI draft").count()) === 1;
    const button = first.getByRole("button", { name: /^Record the judgement of / });
    const name = (await button.textContent()) ?? "";
    await button.focus();
    await page.keyboard.press("Enter");
    await page.getByText(/^Recorded your judgement of /).waitFor({ timeout: 15_000 });
    const stayed = (await page.evaluate(() => document.activeElement?.textContent)) === name.replace("Record the", "Change the"); // the same button, its judgement now recorded
    const status = await first.locator("xpath=..").innerText();
    const recorded = status.includes("Your judgement:");
    const derived = toComment === "Consider the brief." && adapting && status.includes("comment adapted from the AI draft");
    // The comparison: the judged criterion beside both markers and the AI, with differences in words.
    const table = await page.getByRole("region", { name: "Comparison table" }).innerText();
    const compared = table.includes("The second marker") && /Agrees with your level|Differs: /.test(table) && table.includes("Not yet judged");
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
  const focusOk = unfocused.length === 0;
  const appOk = chooserFocused && emptyOk && requestOk && originalsOk && rubricOk && briefOk && anonymisedOk && reviewOk && markingOk && readingOk && judgedOk && blindOk && overviewOk && focusOk;
  if (!appOk) failures++;
  console.log(`${appOk ? "PASS" : "FAIL"} the app sets up a moderation from the keyboard: request, originals, a previewed grid rubric, the brief, anonymisation with review (real values only on request) and approval, the original marking (import, check, confirm, enter by hand) and the AI reading (plan, confirm, send); then reviews one submission openly, records a judgement, adapts the AI draft into its comment, compares it and records a verdict, and another blind (hidden until every criterion is judged, then revealed and revised); the overview shows each step and the agreement across the sample; focus moves to each step's heading`);
  if (!appOk) console.log(`    agreement: ${JSON.stringify(agreed)} ${JSON.stringify(byCriterion)}`);
  if (!appOk) console.log(`    steps: ${JSON.stringify({ chooserFocused, emptyOk, requestOk, originalsOk, rubricOk, briefOk, anonymisedOk, reviewOk, markingOk, readingOk, judgedOk, blindOk, overviewOk, unfocused })}\n    ${appNotes.join("\n    ")}\n    rows: ${JSON.stringify(rows)}`);

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
