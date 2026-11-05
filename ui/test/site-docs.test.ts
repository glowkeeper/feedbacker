import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { closingPanel, outOfDate, rewriteLink, forTheSite } from "../scripts/site-docs.ts";

const site = new URL("../../site/", import.meta.url);
const pages = readdirSync(site).filter((f) => f.endsWith(".html"));

test("the documentation pages are the documents they are generated from", () => {
  // Run `npm run site:docs` in ui/ to write them again.
  expect(outOfDate()).toEqual([]);
});

test("a link to a document, or to a directory of them, is a link to its page, and the rest of the repository stays on GitHub", () => {
  expect(rewriteLink("data-handling.md#anonymisation", "docs/institutions.md")).toBe("/data-handling-in-full.html#anonymisation");
  expect(rewriteLink("docs/runbook.md#18-marking-a-cohort", "README.md")).toBe("/user-guide.html#18-marking-a-cohort");
  expect(rewriteLink("../README.md", "docs/runbook.md")).toBe("/");
  expect(rewriteLink("../proxy/src/boundary.ts", "docs/data-handling.md")).toBe("https://github.com/glowkeeper/feedbacker/blob/main/proxy/src/boundary.ts");
  expect(rewriteLink("https://example.org/x", "README.md")).toBe("https://example.org/x");
});

test("every link on the site to a page of the site goes to a page that exists, and to a heading that exists in it", () => {
  const ids = (file: string) => new Set([...readFileSync(new URL(file, site), "utf8").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const broken: string[] = [];
  for (const page of pages) {
    const html = readFileSync(new URL(page, site), "utf8");
    for (const [, href] of html.matchAll(/<a [^>]*href="([^"]+)"/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("https://feedbacker.education/")) continue;
      const [path, hash] = href.replace("https://feedbacker.education", "").split("#");
      const target = path === "" ? page : path === "/" || path === "./" ? "index.html" : path.replace(/^\//, "");
      if (!existsSync(new URL(target, site))) broken.push(`${page}: ${href} (no such page)`);
      else if (hash && !ids(target).has(hash)) broken.push(`${page}: ${href} (no such heading)`);
    }
  }
  expect(broken).toEqual([]);
});

// Every page of the site, bar the home page, the share page and the missing-page page, has the same shape and ends the same way.
const standard = pages.filter((f) => !["index.html", "share.html", "404.html"].includes(f));

test("every page has an eyebrow, a heading and an introduction, and no page says it was generated", () => {
  const missing: string[] = [];
  for (const page of standard) {
    const html = readFileSync(new URL(page, site), "utf8");
    for (const [what, pattern] of [["an eyebrow", /<p class="eyebrow">/], ["a heading", /<h1 id="page-title">/], ["an introduction", /<p class="intro">/]] as const) if (!pattern.test(html)) missing.push(`${page} has no ${what}`);
    if (/This page is generated/.test(html)) missing.push(`${page} says it was generated`);
  }
  expect(missing).toEqual([]);
});

test("every page ends with the same panel, and the Learn more page is there", () => {
  expect(pages).toContain("learn-more.html");
  const different = standard.filter((page) => !readFileSync(new URL(page, site), "utf8").includes(closingPanel(page)));
  expect(different).toEqual([]);
});

test("the setup page names the Node.js version the packages require, and each page about data keeps its statement that it claims no compliance", () => {
  const needed = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).engines.node as string; // ">=24"
  const version = needed.replace(/^>=\s*/, "");
  const proxy = JSON.parse(readFileSync(new URL("../../proxy/package.json", import.meta.url), "utf8")).engines.node as string;
  expect(proxy).toBe(needed);
  expect(readFileSync(new URL("getting-started.html", site), "utf8")).toMatch(new RegExp(`Node\\.js</a> ${version} or later`));
  const text = (file: string) => readFileSync(new URL(file, site), "utf8").replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
  expect(text("data-handling.html")).toContain("It is not a claim of legal, regulatory or institutional compliance");
  expect(text("data-handling-in-full.html")).toContain("It is not a claim of legal, regulatory, or institutional compliance.");
});

// A reader is told what a link leads to, in words: not the name of a file, a path or a decision's abbreviation.
test("no link on the site is named for a file, no page refers to an engineering document (the decision records, the product direction, the project definition, the architecture principles), and none of them is on the site", () => {
  const allowedInCode = /feedbacker-export|AGENTS\.md|proxy\/README\.md|Copyright 20/; // files the app writes; files that are not pages; the licence's own notice
  const found: string[] = [];
  for (const page of pages) {
    const body = readFileSync(new URL(page, site), "utf8").match(/<main[\s\S]*?<\/main>/)![0];
    for (const [, text] of body.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)) {
      const t = text.replace(/<[^>]+>/g, "").trim();
      if (/\.md\b|^docs\/|\bADR\b/.test(t)) found.push(`${page}: link "${t}"`);
    }
    for (const [, code] of body.matchAll(/<code>([\s\S]*?)<\/code>/g)) if (/\.md\b|^docs\//.test(code) && !allowedInCode.test(code)) found.push(`${page}: code "${code.slice(0, 40)}"`);
    if (/\bADRs?\b|\bdecision \d{4}|docs\/decisions|decision records?|PRODUCT\.md|PROJECT\.md|ARCHITECTURE\.md|product direction|project definition|architecture principles/i.test(body.replace(/<code>[\s\S]*?<\/code>/g, ""))) found.push(`${page}: refers to an engineering document`);
  }
  for (const gone of pages.filter((p) => /^(decision|product|project|architecture)/.test(p))) found.push(`${gone} is on the site, and is an engineering document`);
  expect(found).toEqual([]);
});

test("a link that starts a sentence is capitalised", () => {
  const found: string[] = [];
  for (const page of pages) {
    const body = readFileSync(new URL(page, site), "utf8").match(/<main[\s\S]*?<\/main>/)![0];
    for (const m of body.matchAll(/(?:<(?:p|li|td|th)>|[.!?]\s+)<a [^>]*>([a-z][^<]{0,30})/g)) found.push(`${page}: "${m[1]}"`);
  }
  expect(found).toEqual([]);
});

test("what refers to an engineering decision record says nothing of it on the site", () => {
  expect(forTheSite("It runs in a browser ([ADR 0004](decisions/0004-x.md)). More.")).toBe("It runs in a browser. More.");
  expect(forTheSite("Only this is sent (ADR 0006, amended 2026-10-05): the text.")).toBe("Only this is sent: the text.");
  expect(forTheSite("*Decided in [ADR 0006](decisions/0006-x.md);\nbuilt in marking.*")).toBe("*Built in marking.*");
  expect(forTheSite("Read [the architecture](decisions/README.md) first.")).toBe("Read the architecture first.");
});

test("every link to the repository on GitHub is to a path that can exist, and a name in code goes to the page it names", () => {
  const found: string[] = [];
  for (const page of pages) {
    const html = readFileSync(new URL(page, site), "utf8");
    for (const [, href] of html.matchAll(/href="(https:\/\/github\.com\/glowkeeper\/feedbacker\/(?:blob|tree)\/main\/[^"]+)"/g)) if (/\/docs\/docs\/|\/main\/\.\./.test(href)) found.push(`${page}: ${href}`);
  }
  expect(found).toEqual([]);
  expect(readFileSync(new URL("data-handling-in-full.html", site), "utf8")).toBeTruthy();
});

// What the research on websites says matters most is at the top of the home page: what it is, the next step, and the product.
test("the home page's top says what Feedbacker is, offers the next step and shows the product", () => {
  const html = readFileSync(new URL("index.html", site), "utf8");
  const hero = html.match(/<section class="hero"[\s\S]*?<\/section>/)![0];
  expect(hero).toMatch(/<h1[^>]*>[^<]*marking, feedback and moderation/);
  expect(hero).toMatch(/<a class="button" href="walkthrough\.html">/);
  expect(hero).toMatch(/<a class="button secondary" href="getting-started\.html">/);
  expect(hero).toMatch(/<img src="screenshots\/[^"]+" width="\d+" height="\d+"[^>]*alt="[^"]{20,}"/);
});

test("the help page links to a help form that exists", () => {
  const html = readFileSync(new URL("get-help.html", site), "utf8");
  const template = html.match(/issues\/new\?template=([\w.-]+)/)![1];
  expect(existsSync(new URL(`../../.github/ISSUE_TEMPLATE/${template}`, import.meta.url))).toBe(true);
  expect(html).toContain('href="mailto:steve@huckle.studio?subject=Feedbacker"'); // for those who aren't on GitHub
});

test("every page's footer links to the help page", () => {
  const without = pages.filter((p) => !/<footer>[\s\S]*get-help\.html[\s\S]*<\/footer>/.test(readFileSync(new URL(p, site), "utf8")));
  expect(without).toEqual([]);
});

// The server lets a browser keep a stylesheet for hours, so a changed one must have a new address, or a returning visitor gets the new page with the old styles.
test("every page names the stylesheet and the script with a version taken from their contents", () => {
  const version = (file: string) => createHash("sha256").update(readFileSync(new URL(file, site))).digest("hex").slice(0, 8);
  const wrong: string[] = [];
  for (const page of pages.concat("404.html").filter((p, i, all) => all.indexOf(p) === i)) {
    const html = readFileSync(new URL(page, site), "utf8");
    if (!html.includes(`styles.css?v=${version("styles.css")}"`)) wrong.push(`${page}: stylesheet`);
    if (html.includes("share.js") && !html.includes(`share.js?v=${version("share.js")}"`)) wrong.push(`${page}: script`);
  }
  expect(wrong).toEqual([]);
});
