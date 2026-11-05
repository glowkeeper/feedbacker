/**
 * The website's documentation pages (`site/*.html`), generated from the Markdown they are the same words as: `docs/` and the README's
 * "Getting started". The Markdown stays the one source, so a page can't drift from the document it shows. The pages are committed, as the
 * rest of the site is (GitHub Pages serves `site/` as it is), and a test fails when one is out of date.
 *
 *   node scripts/site-docs.ts          write the pages
 *   node scripts/site-docs.ts --check  say which pages are out of date, and fail if any is
 *
 * Their header and footer are the announcement page's, so the pages share the site's own. Links between the documents become links
 * between the pages; a link to anything else in the repository (a decision record, the code, the security policy) goes to it on GitHub.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Marked, type Tokens } from "marked";
import { COPY, DECISION_INTRO, HUB, LABELS, PANEL } from "./site-copy.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const site = `${root}site/`;
const GITHUB = "https://github.com/glowkeeper/feedbacker";
const SITE = "https://feedbacker.education";

interface Page {
  /** The document it is generated from (relative to the repository), and, for a part of one, the heading of the section. */
  source: string;
  section?: string;
  /** Its file in `site/`. */
  page: string;
  /** The line above its heading. */
  eyebrow: string;
}

const SEEDS: Page[] = [
  { source: "docs/responsible-use.md", page: "responsible-use.html", eyebrow: "Responsible use" },
  { source: "docs/accessibility.md", page: "accessibility.html", eyebrow: "Accessibility" },
  { source: "docs/marking-evaluation.md", page: "marking-evaluation.html", eyebrow: "Evaluation" },
  { source: "docs/moderation-evaluation.md", page: "moderation-evaluation.html", eyebrow: "Evaluation" },
  { source: "docs/data-handling.md", page: "data-handling.html", eyebrow: "How data is handled" },
  { source: "docs/runbook.md", page: "user-guide.html", eyebrow: "User guide" },
  { source: "README.md", section: "Getting started", page: "getting-started.html", eyebrow: "Setup guide" },
  { source: "SECURITY.md", page: "security.html", eyebrow: "Security" },
  { source: "LICENSE", page: "licence.html", eyebrow: "Licence" },
];

/** Documents the site has no page of, because they are for people working on the code, not for readers of the site. */
const NOT_PAGES = new Set(["AGENTS.md", "CLAUDE.md"]);

/** A page's file name from its document's path: flat, as the others are. */
function pageName(source: string): string {
  const parts = source.replace(/\.md$/, "").split("/");
  const base = parts.at(-1)!;
  if (parts.length > 1 && base === "README") return `${parts.at(-2)}.html`; // docs/decisions/README.md, proxy/README.md
  const flat = base.toLowerCase().replace(/_/g, "-");
  return `${parts.at(-2) === "decisions" ? "decision-" : ""}${flat}.html`;
}

const EYEBROWS: Record<string, string> = { "docs/decisions/": "Decision record" };
const eyebrowOf = (source: string) => Object.entries(EYEBROWS).find(([dir]) => source.startsWith(dir))?.[1] ?? (source.startsWith("docs/") ? "Documentation" : "About Feedbacker");

/** The Markdown a page shows: the whole document, or the section of it named. The licence is plain text, shown as it is, with its notice. */
const markdownOf = (p: Page) => {
  const text = readFileSync(`${root}${p.source}`, "utf8");
  if (p.source !== "LICENSE") return text;
  const notice = readFileSync(`${root}NOTICE`, "utf8").trim();
  return `# Apache License 2.0\n\nFeedbacker is free and open source, under the Apache License, Version 2.0. The notice, then the licence in full.\n\n## Notice\n\n${notice.replace(/^/gm, "    ")}\n\n## Licence\n\n${text.trim().replace(/^/gm, "    ")}\n`;
};

/** The documents a page links to (not code, not images), in the order they are met. */
function linkedDocuments(p: Page): string[] {
  const md = p.section ? sectionOf(markdownOf(p), p.section) : markdownOf(p);
  const found: string[] = [];
  for (const m of md.matchAll(/\]\(([^)\s]+)\)/g)) {
    const href = m[1];
    if (href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    const resolved = posix.normalize(posix.join(posix.dirname(p.source), href.split("#")[0]));
    if (resolved.endsWith(".md") && existsSync(`${root}${resolved}`) && !NOT_PAGES.has(resolved)) found.push(resolved);
    else if (resolved.endsWith("/") && existsSync(`${root}${resolved}README.md`)) found.push(`${resolved}README.md`);
  }
  return found;
}

/** Every page: those named above, and every document they link to, and those link to, so the reader never has to leave the site to follow a link between documents. */
export const PAGES: Page[] = (() => {
  const pages = [...SEEDS];
  const have = new Set(pages.filter((p) => !p.section).map((p) => p.source));
  have.add("docs/institutions.md"); // written by hand, from its document
  for (let i = 0; i < pages.length; i++) {
    for (const source of linkedDocuments(pages[i])) {
      if (source === "README.md" || have.has(source)) continue; // the README's address is the home page
      have.add(source);
      pages.push({ source, page: pageName(source), eyebrow: eyebrowOf(source) });
    }
  }
  const names = pages.map((p) => p.page);
  const clash = names.find((n, i) => names.indexOf(n) !== i);
  if (clash) throw new Error(`two documents would be the page ${clash}`);
  return pages;
})();

/** Where a document is on the site, for links between them. `institutions.html` is written by hand, from its document. */
const SITE_PAGES = new Map<string, string>([...PAGES.filter((p) => !p.section).map((p) => [p.source, p.page] as [string, string]), ["docs/institutions.md", "institutions.html"], ["README.md", ""]]);

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plain = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** GitHub's heading addresses, so a link to `data-handling.md#anonymisation` works on the page as it does there. */
function slugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s/g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

/** Where a link in a document goes on the site: another page, or the repository on GitHub. */
export function rewriteLink(href: string, source: string): string {
  if (href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
    // An address of the repository's docs on GitHub is the site's own page, where there is one.
    const m = href.match(new RegExp(`^${GITHUB}/blob/main/([^#]+)(#.*)?$`));
    const page = m && SITE_PAGES.get(m[1]);
    return page ? `/${page}${m![2] ?? ""}` : href;
  }
  const [path, hash = ""] = href.split("#");
  const resolved = posix.normalize(posix.join(posix.dirname(source), path));
  if (resolved === "README.md" && hash === "getting-started") return "/getting-started.html";
  const asDocument = resolved.endsWith("/") ? `${resolved}README.md` : resolved;
  const page = SITE_PAGES.get(asDocument);
  if (page !== undefined) return `/${page}${hash ? `#${hash}` : ""}`;
  const onGitHub = `${GITHUB}/${path.endsWith("/") ? "tree" : "blob"}/main/${resolved}`;
  return hash ? `${onGitHub}#${hash}` : onGitHub;
}

function render(markdown: string, source: string): { html: string; intro: string | null } {
  const slug = slugger();
  let under = "";
  const md = new Marked({ gfm: true });
  md.use({
    walkTokens(token) {
      if (token.type === "link") token.href = rewriteLink(token.href, source);
    },
    renderer: {
      heading(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, token: Tokens.Heading) {
        const inner = this.parser.parseInline(token.tokens as Tokens.Generic[]);
        under = plain(inner);
        return `<h${token.depth} id="${escape(slug(under))}">${inner}</h${token.depth}>\n`;
      },
      // A table or a block of code that is wider than the page scrolls in a region of its own, which a keyboard can reach and which says what it holds.
      table(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, token: Tokens.Table) {
        const cell = (c: Tokens.TableCell, tag: "th" | "td", scope = "") => `<${tag}${scope}${c.align ? ` style="text-align:${c.align}"` : ""}>${this.parser.parseInline(c.tokens as Tokens.Generic[])}</${tag}>`;
        const head = `<thead><tr>${token.header.map((c) => cell(c, "th", ' scope="col"')).join("")}</tr></thead>`;
        const body = `<tbody>${token.rows.map((r) => `<tr>${r.map((c, i) => cell(c, i === 0 ? "th" : "td", i === 0 ? ' scope="row"' : "")).join("")}</tr>`).join("")}</tbody>`;
        return `<div class="scroll" role="region" tabindex="0" aria-label="${escape(under ? `Table: ${under}` : "Table")}"><table><caption class="visually-hidden">${escape(under || "Table")}</caption>${head}${body}</table></div>\n`;
      },
      code(token: Tokens.Code) {
        return `<pre class="scroll" tabindex="0" role="region" aria-label="${escape(under ? `Code: ${under}` : "Code")}"><code>${escape(token.text)}</code></pre>\n`;
      },
    },
  });
  const html = md.parse(markdown) as string;
  const first = html.match(/^<p>([\s\S]*?)<\/p>\n/);
  return first ? { html: html.slice(first[0].length), intro: first[1] } : { html, intro: null };
}

/** A part of a document: the Markdown under one second-level heading, down to the next. */
function sectionOf(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const from = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (from < 0) throw new Error(`no "## ${heading}" in the document`);
  const to = lines.findIndex((l, i) => i > from && /^## /.test(l));
  return lines.slice(from + 1, to < 0 ? undefined : to).join("\n");
}

/** The site's own header and footer, as the announcement page has them. */
function chrome(page: string) {
  const announcement = readFileSync(`${site}announcement.html`, "utf8");
  const start = announcement.indexOf('    <a class="skip"');
  let header = announcement.slice(start, announcement.indexOf("    </header>") + "    </header>\n".length);
  if (page === "learn-more.html") header = header.replace('<a href="learn-more.html">', '<a href="learn-more.html" aria-current="page">');
  const footer = announcement.slice(announcement.indexOf("    <footer>"));
  return { header, footer };
}

/** Inline Markdown, with its links to documents made links to their pages. */
function inline(text: string, source: string): string {
  const md = new Marked({ gfm: true });
  md.use({
    walkTokens(token) {
      if (token.type === "link") token.href = rewriteLink(token.href, source);
    },
  });
  return md.parseInline(text) as string;
}

/** The panel every page ends with: the same invitation, with the page's own link left out. */
export function closingPanel(page: string): string {
  const links = PANEL.links.filter(([file]) => file !== page).map(([file, label]) => `            <li><a href="${file}">${escape(label)}</a></li>`);
  return `      <section class="closing next" aria-labelledby="next-title">
        <p class="eyebrow">${escape(PANEL.eyebrow)}</p>
        <h2 id="next-title">${escape(PANEL.heading)}</h2>
        <p>${escape(PANEL.text)}</p>
        <ul class="links">
${links.join("\n")}
        </ul>
      </section>
`;
}

const alsoList = (items: [string, string][]) =>
  items.length
    ? `          <nav class="also" aria-labelledby="also-title">
            <h2 id="also-title">Also on this site</h2>
            <ul class="links">
${items.map(([file, label]) => `              <li><a href="${file}">${escape(label)}</a></li>`).join("\n")}
            </ul>
          </nav>
`
    : "";

/** A long page opens with where it goes. */
function contents(html: string): string {
  const heads = [...html.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map((m) => [m[1], plain(m[2])]);
  if (heads.length < 6) return "";
  return `          <nav class="toc" aria-labelledby="toc-title">
            <h2 id="toc-title">On this page</h2>
            <ol>
${heads.map(([id, text]) => `              <li><a href="#${escape(id)}">${escape(text)}</a></li>`).join("\n")}
            </ol>
          </nav>
`;
}

/** A page of the site around what it shows. */
function shell(o: { page: string; title: string; eyebrow: string; intro: string | null; body: string; comment: string; also?: [string, string][] }): string {
  const description = plain(o.intro ?? o.title).replace(/\s+/g, " ").trim().slice(0, 200);
  const url = `${SITE}/${o.page}`;
  const { header, footer } = chrome(o.page);
  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#17251f">
    <meta name="description" content="${escape(description)}">
    <link rel="canonical" href="${url}">
    <meta property="og:site_name" content="Feedbacker">
    <meta property="og:locale" content="en_GB">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${url}">
    <meta property="og:title" content="${escape(o.title)}. Feedbacker">
    <meta property="og:description" content="${escape(description)}">
    <meta property="og:image" content="${SITE}/preview.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="Feedbacker: AI-assisted marking and moderation, with educators in control. For higher education; free and open source; runs on your computer.">
    <meta name="twitter:card" content="summary_large_image">
    <title>${escape(o.title)}. Feedbacker</title>
    <link rel="icon" href="favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="styles.css">
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", name: o.title, url, description, isPartOf: { "@type": "WebSite", name: "Feedbacker", url: `${SITE}/` } })}</script>
  </head>
  <body>
    <!-- ${o.comment} -->
${header}
    <main id="main" class="article">
      <article aria-labelledby="page-title">
        <p class="eyebrow">${escape(o.eyebrow)}</p>
        <h1 id="page-title">${escape(o.title)}.</h1>${o.intro ? `\n        <p class="intro">${o.intro}</p>` : ""}

        <div class="prose doc">
${contents(o.body)}${o.body}${alsoList(o.also ?? [])}        </div>
      </article>
${closingPanel(o.page)}    </main>

${footer}`;
}

const decisionPages = () => PAGES.filter((p) => p.page.startsWith("decision-")).sort((a, b) => a.page.localeCompare(b.page)); // by number

export function buildPage(p: Page): string {
  const markdown = markdownOf(p);
  const copy = COPY[p.page] ?? {};
  const own = p.section ?? markdown.match(/^# (.+)$/m)![1];
  const body = p.section ? sectionOf(markdown, p.section) : markdown.replace(/^# .+\n/, "");
  const rendered = render(body, p.source);
  // The licence is prose, kept in its lines and its indents, so it wraps at the page's width instead of scrolling.
  let html = p.source === "LICENSE" ? rendered.html.replace(/<pre class="scroll"[^>]*>/g, '<pre class="wrap">') : rendered.html;
  const isDecision = p.page.startsWith("decision-");
  const siteIntro = copy.intro ?? (isDecision ? DECISION_INTRO : undefined);
  const intro = siteIntro !== undefined ? inline(siteIntro, p.source) : rendered.intro;
  if (siteIntro !== undefined && copy.keepOpening && rendered.intro) html = `<p>${rendered.intro}</p>\n${html}`;
  if (copy.lead) html = `<p>${inline(copy.lead, p.source)}</p>\n${html}`;
  let also: [string, string][] = (copy.also ?? []).map((f) => [f, LABELS[f]]);
  if (isDecision) {
    const all = decisionPages();
    const i = all.findIndex((d) => d.page === p.page);
    const name = (d: Page) => markdownOf(d).match(/^# (.+)$/m)![1];
    also = [...(i > 0 ? [[all[i - 1].page, `Previous: ${name(all[i - 1])}`] as [string, string]] : []), ...(i < all.length - 1 ? [[all[i + 1].page, `Next: ${name(all[i + 1])}`] as [string, string]] : []), ["decisions.html", LABELS["decisions.html"]]];
  }
  return shell({
    page: p.page,
    title: copy.title ?? own,
    eyebrow: copy.eyebrow ?? (isDecision ? "Decision record" : p.eyebrow),
    intro,
    body: html,
    comment: `Generated from ${p.source} by ui/scripts/site-docs.ts; edit that document, or ui/scripts/site-copy.ts, not this page.`,
    also,
  });
}

/** The Learn more page, which lists every page of the site that is not on the home page's own path. */
export function buildHub(): string {
  const list = (items: [string, string, string?][]) =>
    `          <ul class="links">\n${items.map(([file, note, label]) => `            <li><a href="${file}">${escape(label ?? LABELS[file])}</a><span class="note">${escape(note)}</span></li>`).join("\n")}\n          </ul>\n`;
  const body =
    HUB.groups.map((g) => `          <h2 id="${g.title.toLowerCase().replace(/\s+/g, "-")}">${escape(g.title)}</h2>\n${list(g.items)}`).join("") +
    `          <h2 id="help-build-it">${escape(HUB.help.title)}</h2>\n          <ul class="links">\n${HUB.help.items.map(([href, label]) => `            <li><a href="${href}">${escape(label)}</a></li>`).join("\n")}\n          </ul>\n`;
  return shell({
    page: "learn-more.html",
    title: HUB.title,
    eyebrow: HUB.eyebrow,
    intro: escape(HUB.intro),
    body,
    comment: "Generated by ui/scripts/site-docs.ts from ui/scripts/site-copy.ts; edit that, not this page.",
  });
}

/** Every generated page, by file name. */
export const buildAll = (): Map<string, string> => new Map([...PAGES.map((p) => [p.page, buildPage(p)] as [string, string]), ["learn-more.html", buildHub()]]);

/** The pages that are not as the documents would make them. */
export function outOfDate(): string[] {
  return [...buildAll()].filter(([name, html]) => !existsSync(`${site}${name}`) || readFileSync(`${site}${name}`, "utf8") !== html).map(([name]) => name);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--check")) {
    const stale = outOfDate();
    if (stale.length) {
      console.error(`Out of date (run: npm run site:docs): ${stale.join(", ")}`);
      process.exit(1);
    }
    console.log("The documentation pages are current.");
  } else {
    for (const [name, html] of buildAll()) writeFileSync(`${site}${name}`, html);
    console.log(`Wrote ${buildAll().size} pages to site/.`);
  }
}
