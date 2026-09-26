/** The PDF layer's rules that the review of #47 questioned: rectangles and whitespace. */

import { getDocument } from "#pdfjs";
import { expect, test } from "vitest";
import { readPage, type Char } from "../src/core/pdf/page.ts";
import { extractTextLines, extractWords } from "../src/core/pdf/text.ts";
import { isPySpace, pySplit, pyStrip } from "../src/core/pytext.ts";

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
