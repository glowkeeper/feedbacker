/**
 * The website (`site/`), audited as the app's screens are (`a11y-audit.ts`): each page in Chrome, against the measured
 * WCAG 2.2 AA checks, and at a phone's width.
 *
 *   node scripts/check-site.ts
 */

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { auditScreen } from "./a11y-audit.ts";
import { chromePath } from "./chrome.ts";

const site = fileURLToPath(new URL("../../site/", import.meta.url));
const pages = readdirSync(site).filter((f) => f.endsWith(".html"));
const browser = await chromium.launch({ executablePath: chromePath() });
let failures = 0;
try {
  for (const name of pages) {
    for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]] as const) {
      const page = await browser.newPage({ viewport });
      await page.goto(`file://${site}${name}`);
      const issues = await auditScreen(page, `${name} (${label})`);
      if (issues.length) failures++;
      console.log(`${issues.length ? "FAIL" : "PASS"} ${name} at ${label} width meets the measured WCAG 2.2 AA checks${issues.length ? `\n    ${issues.join("\n    ")}` : ""}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
process.exit(failures ? 1 : 0);
