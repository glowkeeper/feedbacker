/**
 * The PDF layer: the rules the review of #47 questioned (rectangles and
 * whitespace), and the #41 spike's operator-level checks, which guard
 * against changes in pdf.js's operator shapes (pdf.js stays pinned).
 */

import { getDocument } from "#pdfjs";
import { expect, test } from "vitest";
import { readPage, type Char } from "../src/core/pdf/page.ts";
import { extractTextLines, extractWords } from "../src/core/pdf/text.ts";
import { isPySpace, pySplit, pyStrip } from "../src/core/pytext.ts";
import { textPdf } from "./builders.ts";

/** One page whose content stream is `content` (raw operators). */
function rawPdf(content: string): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

async function rects(content: string): Promise<number> {
  const task = getDocument({ data: rawPdf(content), verbosity: 0 });
  try {
    return (await readPage(await (await task.promise).getPage(1))).rects;
  } finally {
    await task.destroy();
  }
}

test.each([
  ["a filled re", "10 10 100 50 re f", 1],
  ["a stroked re", "10 10 100 50 re S", 1],
  ["two re in one path", "10 10 100 50 re 200 200 30 30 re f", 2],
  ["a closed four-line box", "10 10 m 110 10 l 110 60 l 10 60 l h S", 1],
  ["a box closed by a fifth line back to the start", "10 10 m 110 10 l 110 60 l 10 60 l 10 10 l h S", 1],
  ["an unpainted re (a clip)", "10 10 100 50 re W n", 0],
  ["a triangle", "10 10 m 110 10 l 60 60 l h S", 0],
  ["a slanted quadrilateral", "10 10 m 110 20 l 110 60 l 10 60 l h S", 0],
  ["an open box", "10 10 m 110 10 l 110 60 l 10 60 l S", 0],
])("rectangles are counted as pdfminer counts them: %s", async (_, content, expected) => {
  expect(await rects(content)).toBe(expected);
});

const char = (text: string, x0: number): Char => ({
  text, x0, x1: x0 + 5, top: 100, bottom: 110, size: 10, upright: true, colour: null, font: "Helvetica",
});
const row = (texts: string[]) => texts.map((t, i) => char(t, 10 + i * 5));

test("words break on Python's whitespace, not JavaScript's", () => {
  // U+FEFF is whitespace to JavaScript's \s but not to Python's isspace(): no break.
  expect(extractWords(row(["a", "﻿", "b"])).map((w) => w.text)).toEqual(["a﻿b"]);
  // U+001C is whitespace to Python but not to JavaScript's \s: a break.
  expect(extractWords(row(["a", "\x1c", "b"])).map((w) => w.text)).toEqual(["a", "b"]);
  expect(extractWords(row(["a", " ", "b"])).map((w) => w.text)).toEqual(["a", "b"]);
});

test("a line keeps characters Python doesn't strip, such as U+FEFF", () => {
  expect(extractTextLines(row(["﻿", "x"])).map((l) => l.text)).toEqual(["﻿x"]);
});

test("the Python whitespace helpers match Python", () => {
  expect(isPySpace(" \t\x1c\x85　")).toBe(true);
  expect(isPySpace("﻿")).toBe(false);
  expect(isPySpace("")).toBe(false);
  expect(pyStrip("\x1c a ﻿")).toBe("a ﻿");
  expect(pySplit("a\x85b﻿c  d")).toEqual(["a", "b﻿c", "d"]);
});

// --- Operator-level checks, moved in from the #41 spike -----------------------------------

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
  const page = await firstPage(["BT /F1 10 Tf 1 0 0 1 60 800 Tm (first) Tj 14 TL T* (second) Tj 0 -20 TD (third) Tj T* (fourth) Tj (fifth) ' ET"]);
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
  const page = await firstPage(["0.5 g BT /F1 10 Tf 60 700 Td (a) Tj ET", "1 0 0 rg BT /F1 10 Tf 60 680 Td (b) Tj ET", "0 0 0 1 k BT /F1 10 Tf 60 660 Td (c) Tj ET"]);
  const [grey, red, black] = page.chars.map((c) => c.colour!);
  expect(grey.map((v) => v.toFixed(2))).toEqual(["0.50", "0.50", "0.50"]);
  expect(red).toEqual([1, 0, 0]);
  // pdf.js converts CMYK for display, so pure black is a very dark grey.
  expect(Math.max(...black)).toBeLessThan(0.25);
});
