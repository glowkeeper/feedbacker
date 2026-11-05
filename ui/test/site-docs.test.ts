import { existsSync, readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { closingPanel, outOfDate, rewriteLink } from "../scripts/site-docs.ts";

const site = new URL("../../site/", import.meta.url);
const pages = readdirSync(site).filter((f) => f.endsWith(".html"));

test("the documentation pages are the documents they are generated from", () => {
  // Run `npm run site:docs` in ui/ to write them again.
  expect(outOfDate()).toEqual([]);
});

test("a link to a document, or to a directory of them, is a link to its page, and the rest of the repository stays on GitHub", () => {
  expect(rewriteLink("data-handling.md#anonymisation", "docs/institutions.md")).toBe("/data-handling.html#anonymisation");
  expect(rewriteLink("docs/runbook.md#18-marking-a-cohort", "README.md")).toBe("/user-guide.html#18-marking-a-cohort");
  expect(rewriteLink("decisions/0004-typescript-browser-core-and-local-proxy.md", "docs/data-handling.md")).toBe("/decision-0004-typescript-browser-core-and-local-proxy.html");
  expect(rewriteLink("decisions/", "docs/data-handling.md")).toBe("/decisions.html");
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
