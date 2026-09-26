/** Character geometry and colour from the operator list (#41). */

import { getDocument } from "#pdfjs";
import { expect, test } from "vitest";
import { readPage } from "../src/page.ts";
import { extractTextLines } from "../src/text.ts";
import { textPdf } from "./pdf.ts";

async function firstPage(content: string[]) {
  const task = getDocument({ data: textPdf([content]), verbosity: 0 });
  try {
    return await readPage(await (await task.promise).getPage(1));
  } finally {
    await task.destroy();
  }
}

const HEIGHT = 841.89;
// A 10 pt Helvetica line with its baseline at `y`, as pdfminer boxes it.
const topAt = (y: number, size = 10) => HEIGHT - (y - 0.207 * size + size);

test("places text set with Tm, TD, TL, T* and '", async () => {
  const page = await firstPage([
    "BT /F1 10 Tf 1 0 0 1 60 800 Tm (first) Tj 14 TL T* (second) Tj 0 -20 TD (third) Tj T* (fourth) Tj (fifth) ' ET",
  ]);
  const lines = extractTextLines(page.chars);
  expect(lines.map((l) => l.text)).toEqual(["first", "second", "third", "fourth", "fifth"]);
  // T* moves down by the leading; TD also sets the leading to its offset.
  const tops = lines.map((l) => l.chars[0].top);
  [800, 786, 766, 746, 726].forEach((y, i) => expect(tops[i]).toBeCloseTo(topAt(y), 6));
  expect(lines.every((l) => l.chars[0].x0 === 60)).toBe(true);
});

test("scales characters by the text matrix and the current transform", async () => {
  const page = await firstPage(["q 1 0 0 1 10 0 cm BT /F1 10 Tf 2 0 0 2 50 700 Tm (big) Tj ET Q"]);
  const [b] = page.chars;
  expect(b.size).toBe(20);
  expect(b.x0).toBe(60);
  expect(b.x1).toBeCloseTo(60 + 2 * 5.56, 6); // Helvetica "b" is 556 units wide
  expect(b.top).toBeCloseTo(topAt(700, 20), 6);
});

test("uses a font set through an ExtGState", async () => {
  const page = await firstPage(["BT /GS1 gs 60 700 Td (gs) Tj ET"]);
  expect(page.chars.map((c) => [c.text, c.size])).toEqual([["g", 12], ["s", 12]]);
});

test("reads grey, RGB and CMYK fills as RGB", async () => {
  const page = await firstPage([
    "0.5 g BT /F1 10 Tf 60 700 Td (a) Tj ET",
    "1 0 0 rg BT /F1 10 Tf 60 680 Td (b) Tj ET",
    "0 0 0 1 k BT /F1 10 Tf 60 660 Td (c) Tj ET",
  ]);
  const [grey, red, black] = page.chars.map((c) => c.colour!);
  expect(grey.map((v) => v.toFixed(2))).toEqual(["0.50", "0.50", "0.50"]);
  expect(red).toEqual([1, 0, 0]);
  // pdf.js converts CMYK for display, so pure black is a very dark grey.
  expect(Math.max(...black)).toBeLessThan(0.25);
});
