/**
 * Measured WCAG 2.2 AA checks for one screen of the app, in Chrome (#19).
 * They cover what can be measured rather than judged:
 *
 * - 1.3.1 / 2.4.6: one h1, and no heading level skipped;
 * - 2.5.3: a control's accessible name contains its visible label;
 * - 2.4.2: the page has a title naming the screen;
 * - 4.1.2 / 3.3.2: every control has an accessible name, every ARIA
 *   reference points at an element, and ids are unique;
 * - 1.4.3 / 1.4.11: text contrast (4.5:1, or 3:1 for large text), and the
 *   contrast of the focus outline;
 * - 2.5.8: targets at least 24 by 24 CSS pixels (inline links in text are
 *   exempt);
 * - 2.1.1 / 2.1.2 / 2.4.7 / 2.4.11: Tab reaches every control with no trap;
 *   each focused control has a visible outline and is not hidden;
 * - 1.4.10: nothing but a scrolling region is wider than 320 CSS pixels;
 * - 1.4.12: with the text spacing the criterion sets, nothing is clipped.
 *
 * The rest (meaning, order, instructions, wording) is judged by reading the
 * screens; see the pull request that added this.
 */

import type { Page } from "playwright-core";

/** Checks that need only the rendered page: headings, names, references, contrast, targets. */
function staticChecks(): string[] {
  const issues: string[] = [];
  const describe = (el: Element) => {
    const name = el.getAttribute("aria-label") || el.id || (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `<${el.tagName.toLowerCase()}${name ? ` "${name}"` : ""}>`;
  };
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !el.closest(".visually-hidden");
  };

  // Headings: one h1, and no level skipped.
  const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter(shown);
  const h1s = headings.filter((h) => h.tagName === "H1").length;
  if (h1s !== 1) issues.push(`1.3.1: ${h1s} h1 headings (expected one)`);
  let level = 0;
  for (const h of headings) {
    const n = Number(h.tagName[1]);
    if (level && n > level + 1) issues.push(`1.3.1: heading level skipped before ${describe(h)} (h${level} to h${n})`);
    level = n;
  }

  // Unique ids, and ARIA references that resolve.
  const ids = new Map<string, number>();
  for (const el of document.querySelectorAll("[id]")) ids.set(el.id, (ids.get(el.id) ?? 0) + 1);
  for (const [id, n] of ids) if (n > 1) issues.push(`4.1.2: the id "${id}" is used ${n} times`);
  for (const attr of ["aria-labelledby", "aria-describedby", "aria-controls"]) {
    for (const el of document.querySelectorAll(`[${attr}]`)) {
      for (const ref of el.getAttribute(attr)!.split(/\s+/).filter(Boolean)) {
        if (!document.getElementById(ref)) issues.push(`4.1.2: ${describe(el)} has ${attr} "${ref}", which isn't an element`);
      }
    }
  }

  // Every control has a name.
  const controls = [...document.querySelectorAll("button, input:not([type=hidden]), select, textarea, a[href], summary, [role=region], [tabindex]:not([tabindex='-1'])")].filter(shown);
  for (const el of controls) {
    const labelled = el.getAttribute("aria-label")?.trim() || el.getAttribute("aria-labelledby");
    const text = (el.textContent ?? "").trim();
    const labels = (el as HTMLInputElement).labels;
    const named = labelled || (["BUTTON", "A", "SUMMARY"].includes(el.tagName) ? text : labels && labels.length > 0 && [...labels].some((l) => l.textContent?.trim()));
    if (!named) issues.push(`4.1.2: ${describe(el)} has no accessible name`);
  }

  // Label in name: an aria-label contains the visible text, so it can be spoken to operate the control.
  const words = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  for (const el of controls.filter((c) => ["BUTTON", "A", "SUMMARY"].includes(c.tagName))) {
    const label = el.getAttribute("aria-label");
    const visible = (el as HTMLElement).innerText?.trim();
    if (label && visible && !words(label).includes(words(visible))) issues.push(`2.5.3: ${describe(el)} is named "${label}", which doesn't contain its visible label "${visible}"`);
  }

  // A title naming the screen, not only the product.
  const h1 = document.querySelector("h1")?.textContent?.trim();
  if (h1 && !document.title.includes(h1)) issues.push(`2.4.2: the page title "${document.title}" doesn't name the screen ("${h1}")`);

  // Contrast of text against its background.
  const rgb = (c: string) => {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
    const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const background = (el: Element) => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = rgb(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const ratio = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const seen = new Set<string>();
  for (const el of document.querySelectorAll("body *")) {
    if (!shown(el) || (el as HTMLButtonElement).disabled || el.closest("[aria-disabled=true]")) continue; // inactive controls are exempt
    if (![...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())) continue;
    const cs = getComputedStyle(el);
    const fg = rgb(cs.color);
    if (!fg) continue;
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const r = ratio(fg, background(el));
    if (r < (large ? 3 : 4.5)) {
      const key = `${cs.color} on ${background(el) && JSON.stringify(background(el))}`;
      if (!seen.has(key)) issues.push(`1.4.3: ${describe(el)} has contrast ${r.toFixed(2)}:1 (${cs.color})`);
      seen.add(key);
    }
  }

  // Target size: 24 by 24, except inline links in a sentence.
  for (const el of document.querySelectorAll("button, input:not([type=hidden]), select, summary, a[href]")) {
    if (!shown(el) || (el.tagName === "A" && el.closest("p, li"))) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) issues.push(`2.5.8: ${describe(el)} is ${r.width.toFixed(0)} by ${r.height.toFixed(0)} px`);
  }
  return issues;
}

/** Tab through the screen: every control is reached, with a visible outline, not hidden, and no trap. */
async function focusChecks(page: Page): Promise<string[]> {
  const issues: string[] = [];
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const visited: string[] = [];
  let stuck = 0;
  for (let i = 0; i < 400; i++) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
      const top = document.elementFromPoint(x, y);
      const path = [el.tagName, el.id, el.getAttribute("aria-label"), (el.textContent ?? "").trim().slice(0, 30), Math.round(r.top + scrollY)].join("|");
      return {
        path,
        outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2,
        outlineColor: cs.outlineColor,
        hidden: !top || !(top === el || el.contains(top) || top.contains(el)),
        focusVisible: el.matches(":focus-visible"),
      };
    });
    if (!state) break; // left the page: the whole screen was reached
    if (visited.includes(state.path)) {
      if (state.path === visited[0]) break;
      if (++stuck > 3) {
        issues.push(`2.1.2: focus is trapped at ${state.path}`);
        break;
      }
      continue;
    }
    visited.push(state.path);
    if (!state.focusVisible || !state.outline) issues.push(`2.4.7: no visible focus outline on ${state.path}`);
    if (state.hidden) issues.push(`2.4.11: the focused ${state.path} is hidden by other content`);
  }
  if (!visited.length) issues.push("2.1.1: Tab reaches nothing");
  return issues;
}

/** Reflow at 320 CSS pixels, and text spacing, measured by changing the page and putting it back. */
async function layoutChecks(page: Page): Promise<string[]> {
  const issues: string[] = [];
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.setViewportSize({ width: 320, height: 640 });
  const wide = await page.evaluate(() => {
    const out: string[] = [];
    const scrolls = (el: Element | null) => {
      for (let e = el; e; e = e.parentElement) {
        const o = getComputedStyle(e).overflowX;
        if ((o === "auto" || o === "scroll") && e !== document.documentElement && e !== document.body) return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.closest(".visually-hidden") || r.right <= 321) continue;
      if (scrolls(el.parentElement) || scrolls(el)) continue;
      out.push(`<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className ? `.${String(el.className).split(" ")[0]}` : ""}> reaches ${Math.round(r.right)} px`);
    }
    return [...new Set(out)].slice(0, 8);
  });
  for (const w of wide) issues.push(`1.4.10: at 320 px, ${w}`);
  await page.setViewportSize(size);

  const clipped = await page.evaluate(() => {
    // A constructed stylesheet, which the app's CSP (style-src 'self') allows where a <style> element isn't.
    const style = new CSSStyleSheet();
    style.replaceSync("* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, style];
    const out: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest(".visually-hidden")) continue;
      const cs = getComputedStyle(el);
      if (cs.overflow !== "hidden" && cs.overflowX !== "hidden" && cs.overflowY !== "hidden" && cs.textOverflow !== "ellipsis") continue;
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) out.push(`<${el.tagName.toLowerCase()}> clips its text`);
    }
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== style);
    return out;
  });
  for (const c of clipped) issues.push(`1.4.12: with increased text spacing, ${c}`);
  return issues;
}

/** Every measured check for the screen as it is now; the page is left as it was found. */
export async function auditScreen(page: Page, screen: string): Promise<string[]> {
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el && el !== document.body ? (el.id || null) : null;
  });
  const issues = [...(await page.evaluate(staticChecks)), ...(await focusChecks(page)), ...(await layoutChecks(page))];
  await page.evaluate(() => scrollTo(0, 0));
  if (focused) await page.evaluate((id) => document.getElementById(id)?.focus(), focused);
  return issues.map((i) => `${screen}: ${i}`);
}
