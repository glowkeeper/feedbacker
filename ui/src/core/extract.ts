/**
 * Deterministic, local text extraction from typed docx and pdf files: a port
 * of `core/src/feedbacker_core/extract.py` (#15, #47).
 *
 * Extraction never calls a model, never reads document metadata, and fails
 * clearly rather than returning partial text that looks complete. Structure is
 * kept as blocks (headings, paragraphs, table rows) with offsets into the text,
 * counted in code points as in Python, and page numbers for PDFs.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { readDocx } from "./docx.ts";
import { Extract, type Actor, type Block, type SourceFormat } from "./models.ts";
import { PdfDocument } from "./pdf/pdfDocument.ts";
import type { PageContent } from "./pdf/page.ts";
import { extractTextLines, type Line } from "./pdf/text.ts";
import { pyStrip } from "./pytext.ts";
import { codePointLength } from "./text.ts";

export const EXTRACTOR: Actor = { kind: "system", label: "feedbacker extract" };

// A page counts as an image page when it has (almost) no text and one image
// covers most of it, as in rendered "current view" report pages.
export const IMAGE_PAGE_MAX_CHARS = 40;
export const IMAGE_PAGE_MIN_COVERAGE = 0.6;
// Too many image pages means the text cannot be extracted reliably.
const IMAGE_PAGES_FAIL_COUNT = 3;
const IMAGE_PAGES_FAIL_SHARE = 0.25;

/** The file cannot be extracted reliably. Nothing partial is returned. */
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

export const sha256Bytes = (bytes: Uint8Array) => bytesToHex(sha256(bytes));

export function sourceFormat(fileName: string): SourceFormat {
  const dot = fileName.lastIndexOf(".");
  const suffix = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  if (suffix === "docx" || suffix === "pdf") return suffix;
  throw new ExtractionError(`unsupported file type '.${suffix}'; Stage 0 extracts typed docx and pdf only`);
}

class Builder {
  text = "";
  length = 0; // in code points
  blocks: Block[] = [];
  warnings: string[] = [];

  add(kind: Block["kind"], content: string, level: number | null = null, page: number | null = null): void {
    const stripped = pyStrip(content);
    if (!stripped) return;
    if (this.text) {
      this.text += "\n\n";
      this.length += 2;
    }
    const start = this.length;
    this.text += stripped;
    this.length += codePointLength(stripped);
    this.blocks.push({ kind, start, end: this.length, level, page });
  }
}

export async function extract(fileName: string, bytes: Uint8Array, now: Date = new Date()): Promise<Extract> {
  const format = sourceFormat(fileName);
  const digest = sha256Bytes(bytes);
  const builder = new Builder();
  if (format === "docx") await extractDocx(bytes, builder);
  else await extractPdf(bytes, builder);
  if (!pyStrip(builder.text)) throw new ExtractionError("no text could be extracted; the file may be empty or image-only");
  return Extract.parse({
    text: builder.text,
    source_sha256: digest,
    blocks: builder.blocks,
    warnings: builder.warnings,
    provenance: {
      source: `file:sha256:${digest}`,
      transformation: "extracted",
      actor: EXTRACTOR,
      timestamp: now.toISOString(),
      input_hashes: [digest],
    },
  });
}

// --- DOCX -------------------------------------------------------------------------

async function extractDocx(bytes: Uint8Array, out: Builder): Promise<void> {
  let content;
  try {
    content = await readDocx(bytes);
  } catch (err) {
    throw new ExtractionError(`the docx file could not be read: ${(err as Error).message}`);
  }
  for (const b of content.blocks) out.add(b.kind, b.text, b.level);
  if (content.tables) out.warnings.push(`${content.tables} table(s) extracted row by row; check layout-dependent content`);
  if (content.images) out.warnings.push(`${content.images} image(s) present; their content is not extracted`);
  if (content.headerFooterText) out.warnings.push("headers and footers are not extracted");
}

// --- PDF --------------------------------------------------------------------------

export function isImagePage(page: PageContent): boolean {
  if (page.chars.length > IMAGE_PAGE_MAX_CHARS || page.images.length === 0) return false;
  const area = page.width * page.height || 1;
  const largest = Math.max(...page.images.map((im) => (im.x1 - im.x0) * (im.bottom - im.top)));
  return largest / area >= IMAGE_PAGE_MIN_COVERAGE;
}

async function extractPdf(bytes: Uint8Array, out: Builder): Promise<void> {
  let pdf: PdfDocument;
  try {
    pdf = await PdfDocument.open(bytes);
  } catch (err) {
    throw new ExtractionError(`the pdf file could not be read: ${(err as Error).name}`);
  }
  try {
    const pages: PageContent[] = [];
    for (let n = 1; n <= pdf.pageCount; n++) {
      try {
        pages.push(await pdf.page(n));
      } catch (err) {
        throw new ExtractionError(`page ${n} could not be read: ${(err as Error).name}`);
      }
    }
    const imagePages = pages.flatMap((p, i) => (isImagePage(p) ? [i + 1] : []));
    if (
      imagePages.length &&
      (imagePages.length >= IMAGE_PAGES_FAIL_COUNT || imagePages.length / pages.length >= IMAGE_PAGES_FAIL_SHARE)
    ) {
      throw new ExtractionError(
        `${imagePages.length} of ${pages.length} pages are images without text ` +
          "(as in a marked 'current view'); this file is unsuitable for text extraction. " +
          "Use the student's original file. Stage 0 has no OCR.",
      );
    }
    pages.forEach((page, i) => {
      const number = i + 1;
      if (imagePages.includes(number)) {
        out.warnings.push(`page ${number} is an image; its content is not extracted`);
        return;
      }
      const lines = extractTextLines(page.chars);
      if (!lines.length) {
        out.warnings.push(`page ${number} is empty`);
        return;
      }
      if (page.images.length) {
        out.warnings.push(`page ${number} contains ${page.images.length} image(s); their content is not extracted`);
      }
      addPdfLines(lines, number, out);
    });
  } finally {
    await pdf.close();
  }
}

/** Python's `statistics.median`. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const visible = (line: Line) => line.chars.filter((c) => pyStrip(c.text) !== "");

function addPdfLines(lines: Line[], page: number, out: Builder): void {
  const sizes = lines.flatMap((line) => visible(line).map((c) => c.size));
  const body = sizes.length ? median(sizes) : 0;
  const heights = lines.map((line) => line.bottom - line.top);
  const gapLimit = (heights.length ? median(heights) : 0) * 0.8;

  const para: string[] = [];
  let previousBottom: number | null = null;
  const flush = () => {
    if (para.length) {
      out.add("paragraph", para.join(" "), null, page);
      para.length = 0;
    }
  };

  for (const line of lines) {
    const text = pyStrip(line.text);
    const lineSizes = visible(line).map((c) => c.size);
    const size = lineSizes.length ? mean(lineSizes) : body;
    const isHeading = body && size >= body * 1.15 && codePointLength(text) <= 120;
    if (isHeading) {
      flush();
      out.add("heading", text, 1, page);
      previousBottom = line.bottom;
      continue;
    }
    if (previousBottom !== null && line.top - previousBottom > gapLimit) flush();
    para.push(text);
    previousBottom = line.bottom;
  }
  flush();
}
