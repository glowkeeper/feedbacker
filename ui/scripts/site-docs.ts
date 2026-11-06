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

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Marked, type Tokens } from "marked";
import { COPY, HUB, LABELS, LINK_NAMES, OWN_PAGES, PANEL, type OwnPage } from "./site-copy.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const site = `${root}site/`;
const GITHUB = "https://github.com/glowkeeper/feedbacker";
const SITE = "https://feedbacker.education";

interface Page {
  /** The document it is generated from (relative to the repository), and, for a part of one, the heading of the section. */
  source: string;
  section?: string;
  /** Or several of its sections, by heading: a long document shown as several pages. */
  sections?: string[];
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
  { source: "docs/data-handling.md", page: "data-handling-in-full.html", eyebrow: "Under the hood" },
  { source: "docs/runbook.md", page: "user-guide.html", eyebrow: "User guide" }, // the guide's first page: its parts are below
  {
    source: "docs/runbook.md",
    page: "user-guide-set-up.html",
    eyebrow: "User guide",
    sections: ["1. Before you start", "2. What stays on your machine, and what is sent to a model", "3. Start Feedbacker", "4. Create a workspace and set its retention", "5. Record the moderation request", "6. Import the source rubric and the brief"],
  },
  {
    source: "docs/runbook.md",
    page: "user-guide-your-material.html",
    eyebrow: "User guide",
    sections: ["7. Download and import the original files", "8. Import and confirm the original marking", "9. Set the anonymisation rules", "10. Anonymise, review and approve"],
  },
  {
    source: "docs/runbook.md",
    page: "user-guide-review-and-finish.html",
    eyebrow: "User guide",
    sections: ["11. Run the AI reading", "12. Review each submission, openly or blind", "13. Record a verdict on each submission's marking", "14. Approve and export the record", "15. Return the moderation form", "16. Delete the workspace and the downloads", "17. If something goes wrong"],
  },
  { source: "docs/runbook.md", page: "user-guide-marking.html", eyebrow: "User guide", sections: ["18. Marking a cohort"] },
  { source: "docs/runbook.md", page: "user-guide-modules.html", eyebrow: "User guide", sections: ["19. A module with more than one assessment"] },
  { source: "README.md", section: "Getting started", page: "getting-started.html", eyebrow: "Setup guide" },
  { source: "SECURITY.md", page: "security.html", eyebrow: "Security" },
  { source: "LICENSE", page: "licence.html", eyebrow: "Licence" },
];

/** Documents the site has no page of, because they are for people working on the code, not for readers of the site: the instructions for working on it, the records of its engineering decisions, and the product direction, project definition and architecture principles. */
const NOT_PAGES = (path: string) => ["AGENTS.md", "CLAUDE.md", "PRODUCT.md", "docs/PROJECT.md", "docs/ARCHITECTURE.md"].includes(path) || path.startsWith("docs/decisions/");

/** A page's file name from its document's path: flat, as the others are. */
function pageName(source: string): string {
  const parts = source.replace(/\.md$/, "").split("/");
  const base = parts.at(-1)!;
  if (parts.length > 1 && base === "README") return `${parts.at(-2)}.html`; // docs/decisions/README.md, proxy/README.md
  const flat = base.toLowerCase().replace(/_/g, "-");
  return `${flat}.html`;
}

const EYEBROWS: Record<string, string> = { "docs/decisions/": "Decision record" };
const eyebrowOf = (source: string) => Object.entries(EYEBROWS).find(([dir]) => source.startsWith(dir))?.[1] ?? (source.startsWith("docs/") ? "Documentation" : "About Feedbacker");

/**
 * The engineering documents aren't on the site (the decision records, the product direction, the project definition and the architecture principles), so
 * what refers to them says nothing of them there: a reference to a decision record in brackets goes, a link to one is only its words, and a sentence that
 * only points at another of them is left out or says what it meant. The documents on GitHub keep all of it.
 */
export function forTheSite(markdown: string): string {
  return markdown
    .replace(/From \[`PRODUCT\.md`\]\(\.\.\/PRODUCT\.md\): ([a-z])/g, (_m, c: string) => c.toUpperCase()) // the evaluations' opening line
    .replace(/taken from `PRODUCT\.md`'s direction;/g, "taken from the project's direction;")
    .replace(/If the rules on what the\s+AI may be sent, in \[`PRODUCT\.md`\]\(\.\.\/PRODUCT\.md\), ever disagree with what follows,\s+`PRODUCT\.md` takes precedence\.\s*/g, "") // data handling's order of precedence
    .replace(/Only what `PRODUCT\.md`'s rules on what the AI may be sent permit:/g, "Only what Feedbacker's rules on what the AI may be sent permit:")
    .replace(/Then follow the runbook: /g, "Then follow the user guide: ") // the README's setup guide
    .replace(/\(see the README\)/g, "(see [Getting started](/getting-started.html))") // responsible use
    .replace(/^- \[The runbook\]\(runbook\.md\)/gm, "- [The user guide](runbook.md)")
    .replace(/^- \[Architecture: accessibility\]\([^)]*\)\n/gm, "") // accessibility's further reading
    .replace(/^- \[Project definition\]\([^)]*\) and \[product direction\]\([^)]*\): [^\n]*\n/gm, "") // responsible use's further reading
    .replace(/Significant decisions are captured as architecture decision records under \[[^\]]*\]\([^)]*\)\.\s*/g, "") // ARCHITECTURE.md
    .replace(/^- \[Decision records\]\([^)]*\):[^\n]*\n/gm, "") // responsible use's list of further reading
    .replace(/\s*See\s+\[ADR\s+\d{4}\]\([^)]*\)\./g, "") // "See ADR 0005."
    .replace(/a recorded decision in `docs\/decisions\/`/g, "a recorded decision")
    .replace(/\*?Decided in \[ADR\s+\d{4}\]\([^)]*\);\s*([a-z])/g, (_m, c: string) => `*${c.toUpperCase()}`) // "Decided in ADR 0006; built in …" -> "Built in …"
    .replace(/\s*\((?:[^()]|\([^()]*\))*?\[ADR\s+\d{4}\]\([^)]*\)[^()]*\)/g, "") // (… [ADR 0004](…), 2026-10-05)
    .replace(/\s*\(ADR\s+\d{4}[^()]*\)/g, "") // (ADR 0006, amended 2026-10-05)
    .replace(/\[([^\]]+)\]\((?:\.\.\/)?(?:docs\/)?decisions\/[^)]*\)/g, "$1"); // a link to a record is only its words
}

/** The Markdown a page shows: the whole document, or the section of it named. The licence is plain text, shown as it is, with its notice. */
const markdownOf = (p: Page) => {
  const text = readFileSync(`${root}${p.source}`, "utf8");
  if (p.source !== "LICENSE") return forTheSite(text);
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
    if (resolved.endsWith(".md") && existsSync(`${root}${resolved}`) && !NOT_PAGES(resolved)) found.push(resolved);
    else if (resolved.endsWith("/") && existsSync(`${root}${resolved}README.md`) && !NOT_PAGES(`${resolved}README.md`)) found.push(`${resolved}README.md`);
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

/** Which page of a document shown as several holds each of its headings, so a link to a step goes to the page the step is on. */
const ANCHOR_PAGES = new Map<string, string>(PAGES.flatMap((p) => (p.sections ?? []).map((h) => [slugOf(h), p.page] as [string, string])));

/** Where a document is on the site, for links between them. `institutions.html` is written by hand, from its document. */
const SITE_PAGES = new Map<string, string>([...PAGES.filter((p) => !p.section && !p.sections).map((p) => [p.source, p.page] as [string, string]), ["docs/institutions.md", "institutions.html"], ["README.md", ""]]);

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plain = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** GitHub's heading addresses, so a link to `data-handling.md#anonymisation` works on the page as it does there. */
function slugOf(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s/g, "-");
}
function slugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = slugOf(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

/** Where a link in a document goes on the site: another page, or the repository on GitHub. */
export function rewriteLink(href: string, source: string, current?: string): string {
  if (href.startsWith("/")) return href; // an address on the site itself
  if (href.startsWith("#") && source === "docs/runbook.md") {
    const page = ANCHOR_PAGES.get(href.slice(1));
    return page && page !== current ? `/${page}${href}` : href;
  }
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
  const step = asDocument === "docs/runbook.md" ? ANCHOR_PAGES.get(hash) : undefined; // a link to one of the guide's steps
  if (step) return `/${step}#${hash}`;
  const page = SITE_PAGES.get(asDocument);
  if (page !== undefined) return `/${page}${hash ? `#${hash}` : ""}`;
  const onGitHub = `${GITHUB}/${path.endsWith("/") ? "tree" : "blob"}/main/${resolved}`;
  return hash ? `${onGitHub}#${hash}` : onGitHub;
}

/** What a link or a code span that only names a document's file is: the file of the site's page it stands for, or undefined if it names none. */
const FILE_LIKE = /^(?:\.\.\/|\.\/)*[\w./-]*?(?:[\w.-]+\.md|decisions\/?)$/;
function pageNamed(text: string, source: string, href?: string): string | undefined {
  const trimmed = text.trim().replace(/^`|`$/g, "");
  if (!FILE_LIKE.test(trimmed) || /\s/.test(trimmed)) return undefined;
  const from = (path: string) => {
    const resolved = posix.normalize(posix.join(posix.dirname(source), path.split("#")[0]));
    return SITE_PAGES.get(resolved.endsWith("/") ? `${resolved}README.md` : resolved);
  };
  // A link is to what its address says; a name in code is from the repository's root, as it is written ("docs/PROJECT.md"), or beside the document.
  return href !== undefined ? from(href) : (SITE_PAGES.get(posix.normalize(trimmed)) ?? SITE_PAGES.get(posix.normalize(`${trimmed}${trimmed.endsWith("/") ? "README.md" : ""}`)) ?? from(trimmed));
}

/** What such a link or code span should say instead of the file's name, or null if it names none that is a page. */
export function nameOf(text: string, source: string, href?: string): string | null {
  const page = pageNamed(text, source, href);
  if (page === undefined) return null;
  if (page === "") return "the README";
  return LINK_NAMES[page] ?? null;
}

function render(markdown: string, source: string, current?: string): { html: string; intro: string | null } {
  const slug = slugger();
  let under = "";
  const md = new Marked({ gfm: true });
  md.use({
    walkTokens(token) {
      // A link says what it leads to, not the name of its file; a file's name in the text is a link to its page; "ADR 0004" is "decision 0004".
      if (token.type === "link") {
        const name = nameOf(token.text, source, token.href);
        token.href = rewriteLink(token.href, source, current);
        if (name) token.tokens = [{ type: "text", raw: name, text: name } as Tokens.Text];
      } else if (token.type === "codespan") {
        const name = nameOf(token.text, source);
        // Its address is the page its name was found to stand for, not the name read again as a path from this document.
        if (name) Object.assign(token, { type: "link", href: `/${pageNamed(token.text, source)}`, title: null, text: name, tokens: [{ type: "text", raw: name, text: name }] });
      } else if (token.type === "text") token.text = token.text.replace(/\bADRs?\b/g, (m: string) => (m === "ADR" ? "decision" : "decisions"));
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
  // A link named for what it leads to ("the project definition") may start a sentence, a paragraph or an item: then it is capitalised.
  const html = (md.parse(markdown) as string).replace(/(<(?:p|li|td|th)>|[.!?]\s+)(<a [^>]*>)([a-z])/g, (_m, before: string, a: string, c: string) => `${before}${a}${c.toUpperCase()}`);
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
  if (heads.length < 8) return "";
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

export function buildPage(p: Page): string {
  const markdown = markdownOf(p);
  const copy = COPY[p.page] ?? {};
  const own = p.section ?? markdown.match(/^# (.+)$/m)![1];
  const body =
    copy.markdown ??
    (p.sections ? p.sections.map((h) => `## ${h}\n${sectionOf(markdown, h)}`).join("\n") : p.section ? sectionOf(markdown, p.section) : markdown.replace(/^# .+\n/, ""));
  const rendered = render(body, p.source, p.page);
  // A first paragraph is taken as the introduction, and the site's own introduction replaces it: written for the site, it must be asked for, not lost.
  if (copy.markdown && copy.intro !== undefined && rendered.intro && !copy.keepOpening) throw new Error(`${p.page}: its Markdown opens with a paragraph that the introduction would replace; start with a heading, or set keepOpening`);
  // The licence is prose, kept in its lines and its indents, so it wraps at the page's width instead of scrolling.
  let html = p.source === "LICENSE" ? rendered.html.replace(/<pre class="scroll"[^>]*>/g, '<pre class="wrap">') : rendered.html;
  const siteIntro = copy.intro;
  const intro = siteIntro !== undefined ? inline(siteIntro, p.source) : rendered.intro;
  if (siteIntro !== undefined && copy.keepOpening && rendered.intro) html = `<p>${rendered.intro}</p>\n${html}`;
  if (copy.lead) html = `<p>${inline(copy.lead, p.source)}</p>\n${html}`;
  const also: [string, string][] = (copy.also ?? []).map((f) => [f, LABELS[f]]);
  return shell({
    page: p.page,
    title: copy.title ?? own,
    eyebrow: copy.eyebrow ?? p.eyebrow,
    intro,
    body: html,
    comment: `Generated from ${p.source} by ui/scripts/site-docs.ts; edit that document, or ui/scripts/site-copy.ts, not this page.`,
    also,
  });
}

/** A page written for the site: its Markdown is in the copy file. */
export function buildOwnPage(p: OwnPage): string {
  const { html } = render(p.markdown, p.source, p.page);
  return shell({
    page: p.page,
    title: p.title,
    eyebrow: p.eyebrow,
    intro: inline(p.intro, p.source),
    body: html,
    comment: "Generated by ui/scripts/site-docs.ts from ui/scripts/site-copy.ts; edit that, not this page.",
    also: p.also.map((f) => [f, LABELS[f]]),
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

/**
 * The stylesheet and the script are named in every page with a version taken from their contents, so a browser that kept an old copy asks for the new one as
 * soon as it changes. Without it, a returning visitor gets the new page with the old styles (the server lets a browser keep a stylesheet for four hours and a
 * page for ten minutes).
 */
const hashOf = (file: string) => createHash("sha256").update(readFileSync(`${site}${file}`)).digest("hex").slice(0, 8);
/** The versions as the files are now: read once, then given to every page. */
const versions = () => ({ css: hashOf("styles.css"), js: hashOf("share.js") });
export function stamped(html: string, v = versions()): string {
  return html.replace(/(href="\/?styles\.css)(?:\?v=[0-9a-f]+)?"/g, `$1?v=${v.css}"`).replace(/(src="\/?share\.js)(?:\?v=[0-9a-f]+)?"/g, `$1?v=${v.js}"`);
}

/** The pages written by hand: the files in site/ that are not generated. They are only given their versions here. */
const handWritten = (generated: Iterable<string>) => {
  const names = new Set(generated);
  return readdirSync(site).filter((f) => f.endsWith(".html") && !names.has(f));
};

/** Every generated page, by file name. */
const buildPages = (): Map<string, string> => new Map([...PAGES.map((p) => [p.page, buildPage(p)] as [string, string]), ["learn-more.html", buildHub()], ...OWN_PAGES.map((p) => [p.page, buildOwnPage(p)] as [string, string])]);
export const buildAll = (): Map<string, string> => {
  const v = versions();
  return new Map([...buildPages()].map(([name, html]) => [name, stamped(html, v)]));
};

/** The pages that are not as the documents would make them. */
export function outOfDate(): string[] {
  const pages = buildAll();
  const v = versions();
  const generated = [...pages].filter(([name, html]) => !existsSync(`${site}${name}`) || readFileSync(`${site}${name}`, "utf8") !== html).map(([name]) => name);
  const stale = handWritten(pages.keys()).filter((f) => {
    const html = readFileSync(`${site}${f}`, "utf8");
    return stamped(html, v) !== html;
  });
  return [...generated, ...stale];
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
    const pages = buildAll();
    const v = versions();
    for (const [name, html] of pages) writeFileSync(`${site}${name}`, html);
    const byHand = handWritten(pages.keys());
    for (const f of byHand) writeFileSync(`${site}${f}`, stamped(readFileSync(`${site}${f}`, "utf8"), v));
    console.log(`Wrote ${pages.size} pages to site/, and versioned the stylesheet and script in the ${byHand.length} written by hand.`);
  }
}
