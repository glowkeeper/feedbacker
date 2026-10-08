/**
 * The website's link-preview image (site/preview.png, 1200 by 630), drawn in Chrome from the site's own look: its paper,
 * ink and accent, its type and wordmark. No screenshot of the app, so nothing in it can be real material. Remake it after
 * changing the site's look or what Feedbacker says it is:
 *
 *   node scripts/site-preview-image.ts
 */

import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { chromePath } from "./chrome.ts";

const out = fileURLToPath(new URL("../../site/preview.png", import.meta.url));
const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><style>
  body { margin: 0; width: 1200px; height: 630px; box-sizing: border-box; padding: 72px 80px; display: flex; flex-direction: column; justify-content: space-between;
         background: radial-gradient(circle at 85% 10%, rgba(184, 216, 199, 0.7), transparent 34rem), #f2efe5; color: #17251f;
         font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .wordmark { font-size: 40px; font-weight: 600; letter-spacing: -0.04em; }
  .wordmark span, em { color: #a94420; }
  h1 { margin: 0; font-size: 84px; font-weight: 500; letter-spacing: -0.06em; line-height: 0.95; }
  em { font-family: Georgia, "Times New Roman", serif; font-weight: 400; }
  p { margin: 0; font-size: 30px; letter-spacing: -0.01em; }
  .rule { height: 6px; width: 120px; background: #e9693d; border-radius: 3px; }
</style></head><body>
  <div class="wordmark">Feedbacker<span>.</span></div>
  <div><h1>AI-assisted marking and moderation, <em>with educators in control.</em></h1></div>
  <div><div class="rule"></div><p style="margin-top: 20px">For higher education · Free and open source · Runs on your computer</p></div>
</body></html>`;

const browser = await chromium.launch({ executablePath: chromePath() });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.screenshot({ path: out });
await browser.close();
console.log(`Wrote ${out}`);
