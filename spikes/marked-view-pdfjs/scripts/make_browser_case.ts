/**
 * A second, harder synthetic marked view, printed to PDF by Chrome rather than
 * drawn by reportlab. Browser-printed PDFs use scaled transforms, positioned
 * glyph runs and embedded subset fonts, which is closer to how real current
 * views are likely produced. Same layout and cues as the replica; all fictional.
 *
 * `node scripts/make_browser_case.ts <out.pdf>`
 */

import { chromium } from "playwright-core";
import { chromePath } from "./chrome.ts";

const LEVELS = [85, 75, 68, 62, 58, 55, 48, 35];
const band = (p: number) => (p >= 70 ? "1st" : p >= 60 ? "2:1" : p >= 50 ? "2:2" : p >= 40 ? "3rd" : "Fail");
const CRITERIA: [string, number, number, number][] = [
  ["REQUIREMENTS", 25, 68, 68],
  ["IMPLEMENTATION", 25, 58, 55], // selected level disagrees with the awarded score
  ["TESTING", 25, 58, 58],
  ["PROFESSIONALISM", 25, 55, 55],
];
const MARKERS: Record<number, [number, number]> = { 1: [1, 0.3], 2: [2, 0.62], 3: [3, 0.45] };

const reportPage = (n: number) => `
  <section class="page report">
    <canvas width="1190" height="1684" data-page="${n}"></canvas>
    ${Object.entries(MARKERS)
      .filter(([, [p]]) => p === n)
      .map(([num, [, y]]) => `<span class="marker" style="top:${y * 100}%">${num}</span>`)
      .join("")}
  </section>`;

const total = CRITERIA.reduce((t, [, w, s]) => t + (w * s) / 100, 0);
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 0 }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #333; font-size: 10pt }
  .page { position: relative; width: 210mm; height: 297mm; box-sizing: border-box; padding: 12mm; break-after: page; overflow: hidden }
  .report { padding: 0 }
  .report canvas { position: absolute; left: 7mm; top: 7mm; width: 196mm; height: 283mm }
  .marker { position: absolute; left: 50%; font-size: 8pt; color: #000; background: #0090ff; padding: 0 2pt; transform: translateY(-50%) }
  .grade-row { display: flex; gap: 10mm; margin: 6mm 0 }
  .grade { width: 52mm } .grade .big { font-size: 40pt; line-height: 1 } .grade .max { margin-top: 2mm }
  .muted { color: #777 } .blue { color: #0090ff }
  .comment { margin: 3mm 0 3mm 12mm } .comment p { margin: 1mm 0 }
  .criterion { margin: 4mm 0 } .criterion p { margin: 1mm 0 }
  .level { color: #999; margin: 1.5mm 0 } .level.selected { color: #000 } .level p { margin: 0 }
</style></head><body>
  <section class="page">
    <h1 style="font-size:16pt;font-weight:normal;margin-left:60mm">Study Buddy Report</h1>
    <p style="margin-left:60mm">by PIKE JORDAN</p>
    <p>Submission date: 15-Jan-2026 09:00AM (UTC+0000)</p>
    <p><b>Submission ID: 100200302</b></p>
    <p>File name: Study_Buddy_1234567_100200302.docx (48.2K)</p>
    <p><b>Word count: 1805</b></p>
    <p><b>Character count: 10234</b></p>
  </section>
  ${[1, 2, 3].map(reportPage).join("")}
  <section class="page">
    <p>Study Buddy Report</p>
    <p class="blue">GRADEMARK REPORT</p>
    <p class="muted">FINAL GRADE GENERAL COMMENTS</p>
    <div class="grade-row">
      <div class="grade"><div class="big">60</div><div class="max">/100</div></div>
      <div>
        <p>Strengths: Jordan built a working planner with clear screens.</p>
        <p>Weaknesses: the timetable bug remains and testing is informal.</p>
        <p>Contact j.pike@example.com if anything is unclear.</p>
      </div>
    </div>
    ${[
      [1, 1, "Requirements", "Good choice of framework, Jordan."],
      [2, 2, "Testing", "Some testing evident."],
      [3, 3, null, "Descriptive rather than reflective."],
    ]
      .map(
        ([page, n, tag, body]) => `
      <p class="muted">PAGE ${page}</p>
      <div class="comment"><p class="blue">Comment ${n}${tag ? ` | ${tag}` : ""}</p><p>-</p><p>${body}</p></div>`,
      )
      .join("")}
  </section>
  <section class="page" style="height:auto;overflow:visible">
    <p style="color:#000">RUBRIC: CMP5001-CW1 ${total} / 100</p>
    ${CRITERIA.map(
      ([name, weight, score, selected]) => `
      <div class="criterion">
        <p>${name} (${weight}%) ${score} / 100</p>
        <p class="muted" style="color:#999">• first aspect\\n• second aspect</p>
        ${LEVELS.map(
          (p) => `<div class="level${p === selected ? " selected" : ""}">
            <p>${band(p)} (${p}) A fictional descriptor for this level.</p>
            <p>(${p}) continued descriptor text.</p></div>`,
        ).join("")}
      </div>`,
    ).join("")}
  </section>
  <script>
    for (const c of document.querySelectorAll("canvas")) {
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#000"; g.font = "24px sans-serif";
      for (let row = 0; row < 40; row++) g.fillText("Fictional report page " + c.dataset.page + " line " + (row + 1) + ".", 80, 80 + row * 38);
    }
  </script>
</body></html>`;

const browser = await chromium.launch({ executablePath: chromePath() });
try {
  const page = await browser.newPage();
  await page.setContent(html);
  await page.pdf({ path: process.argv[2], format: "A4", printBackground: true, preferCSSPageSize: true });
} finally {
  await browser.close();
}
