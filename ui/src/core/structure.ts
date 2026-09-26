/**
 * Structure-only inspection of documents and archives: a port of
 * `core/src/feedbacker_core/structure.py` (#15, #47).
 *
 * Reports counts and layout facts so unfamiliar formats can be understood
 * without exposing content. It never outputs document text, metadata values,
 * annotation or comment contents, or real file names: archive entry names are
 * shown only as shapes, with letters replaced by 'a' and digits by '9'. The
 * lines are formatted exactly as the Python command line prints them.
 */

import { inspectDocxStructure } from "./docx.ts";
import { PdfDocument } from "./pdf/pdfDocument.ts";
import { extractTextLines, extractWords } from "./pdf/text.ts";
import { pyStrip, WS } from "./pytext.ts";
import { bytesSource, listZip } from "./zip.ts";

export class InspectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspectionError";
  }
}

const COMMENT_HEADING = /^Comment \d+\b/;
// Python's re gives \s its own whitespace set, so use that rather than JavaScript's.
const BAND_LABEL = new RegExp(`\\b(1ST|2:1|2:2|3RD|FAIL)[${WS}]*\\(\\d{1,3}\\)`, "g");
const SAFE_PUNCTUATION = new Set(" ._-()[]+,&'");

function shapeChar(ch: string): string {
  if (/^\p{Nd}$/u.test(ch)) return "9";
  if (/^\p{L}$/u.test(ch)) return /^\p{Lu}$/u.test(ch) ? "A" : "a";
  return SAFE_PUNCTUATION.has(ch) ? ch : "?";
}

/**
 * "García_Élodie_12345_report.docx" -> "Aaaaaa_Aaaaaa_99999_aaaaaa.docx".
 * Every letter (in any script) and digit is replaced, and anything other than
 * common punctuation becomes '?', so no part of a real name survives. Only a
 * short, purely ASCII-alphanumeric extension is kept.
 */
export function nameShape(name: string): string {
  const dot = name.lastIndexOf(".");
  let stem = dot >= 0 ? name.slice(0, dot) : name;
  let suffix = dot >= 0 ? name.slice(dot + 1) : "";
  if (dot < 0 || !/^[A-Za-z0-9]{1,5}$/.test(suffix)) {
    stem = name;
    suffix = "";
  }
  const shaped = [...stem].map(shapeChar).join("");
  return suffix ? `${shaped}.${suffix.toLowerCase()}` : shaped;
}

// --- Python-style formatting, so the lines read as the command line's ---------------

function pyStr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  const escaped = s.replace(/\\/g, "\\\\").replace(quote === "'" ? /'/g : /"/g, `\\${quote}`);
  return `${quote}${escaped}${quote}`;
}
const pyList = (items: string[]) => `[${items.map(pyStr).join(", ")}]`;
const pyDict = (entries: [string, number][]) => `{${entries.map(([k, v]) => `${pyStr(k)}: ${v}`).join(", ")}}`;

/** Python's Counter: most common first, ties in first-seen order. */
function counter(values: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()];
}
const mostCommon = (entries: [string, number][], n?: number) => [...entries].sort((a, b) => b[1] - a[1]).slice(0, n);

// --- Inspection --------------------------------------------------------------------

export async function inspectFile(fileName: string, bytes: Uint8Array): Promise<string[]> {
  const dot = fileName.lastIndexOf(".");
  const suffix = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  const inspectors: Record<string, (b: Uint8Array) => Promise<string[]>> = {
    ".pdf": inspectPdf,
    ".docx": inspectDocx,
    ".zip": (b) => inspectZip(fileName, b),
  };
  if (!inspectors[suffix]) throw new InspectionError(`unsupported file type '${nameShape(suffix) || "none"}'`);
  try {
    return await inspectors[suffix](bytes);
  } catch (err) {
    // Parser errors can quote content, so report the type only.
    throw new InspectionError(`could not inspect this ${suffix} file (${(err as Error).name}); it may be damaged`);
  }
}

export async function inspectPdf(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PdfDocument.open(bytes);
  try {
    const out = [`type: pdf, pages: ${pdf.pageCount}`, `metadata keys present: ${pyList(await pdf.metadataKeys())}`];
    for (let i = 1; i <= pdf.pageCount; i++) {
      const page = await pdf.page(i);
      const area = page.width * page.height || 1;
      const coverage = Math.max(0, ...page.images.map((im) => ((im.x1 - im.x0) * (im.bottom - im.top)) / area));
      const words = extractWords(page.chars);
      const lines = extractTextLines(page.chars).map((l) => l.text).filter((t) => pyStrip(t));
      const fonts = mostCommon(counter(page.chars.map((c) => c.font.split("+").at(-1)!)), 4);
      const annotations = counter(await pdf.annotationTypes(i));
      out.push(
        `p${i}: chars=${page.chars.length} words=${words.length} ` +
          `digit-words=${words.filter((w) => /^\p{Nd}+$/u.test(w.text)).length} lines=${lines.length} ` +
          `images=${page.images.length} largest-image=${(coverage * 100).toFixed(0)}% rects=${page.rects} ` +
          `annotations=${pyDict(annotations)} ` +
          `comment-headings=${lines.filter((l) => COMMENT_HEADING.test(l)).length} ` +
          `band-labels=${lines.reduce((n, l) => n + [...l.matchAll(BAND_LABEL)].length, 0)} ` +
          `fonts=${pyDict(fonts)}`,
      );
    }
    return out;
  } finally {
    await pdf.close();
  }
}

export async function inspectDocx(bytes: Uint8Array): Promise<string[]> {
  const s = await inspectDocxStructure(bytes);
  return [
    "type: docx",
    `paragraphs: ${s.paragraphs}, words: ${s.words}, tables: ${s.tables}, images: ${s.images}, sections: ${s.sections}`,
    `paragraph style kinds: ${pyDict(s.styleKinds)}`,
    `non-empty header/footer paragraphs: ${s.headerFooterParagraphs}`,
    `metadata fields filled: ${pyList(s.metadataFilled)}`,
  ];
}

function safeSuffix(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const suffix = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  return /^[a-z0-9]{1,5}$/.test(suffix) ? `.${suffix}` : "(other)";
}

export async function inspectZip(fileName: string, bytes: Uint8Array): Promise<string[]> {
  const members = (await listZip(bytesSource(fileName, bytes))).filter((e) => !e.isDirectory);
  const kinds = counter(members.map((m) => safeSuffix(m.name)));
  const shapes = counter(members.map((m) => nameShape(m.name.slice(m.name.lastIndexOf("/") + 1))));
  const inFolders = members.some((m) => m.name.replace(/\/+$/, "").includes("/"));
  return [
    `type: zip, files: ${members.length}, in subfolders: ${inFolders ? "True" : "False"}`,
    `file types: ${pyDict(kinds)}`,
    "file name shapes (letters -> a/A, digits -> 9):",
    ...mostCommon(shapes, 10).map(([shape, count]) => `  ${count} x ${shape}`),
  ];
}

