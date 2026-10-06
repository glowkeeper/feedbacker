/**
 * Deterministic, local text extraction from typed docx and pdf files: a port
 * of `core/src/feedbacker_core/extract.py`.
 *
 * Extraction never calls a model, never reads document metadata, and fails
 * clearly rather than returning partial text that looks complete. Structure is
 * kept as blocks (headings, paragraphs, table rows) with offsets into the text,
 * counted in code points as in Python, and page numbers for PDFs.
 *
 * Figures (embedded images) are marked in the text where they were, each by
 * its placeholder (`[FIGURE_1]`…) as a block of its own, and their bytes are
 * returned beside the extract for the workspace to keep: a docx image's own
 * file, a PDF image's pixels as PNG. Images smaller than 32 points either way
 * (bullets, icons, rules) are left out.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { readDocx } from "./docx.ts";
import { Extract, type Actor, type Block, type Figure, type SourceFormat } from "./models.ts";
import { PdfDocument } from "./pdf/pdfDocument.ts";
import type { ImageBox, PageContent } from "./pdf/page.ts";
import { cleanable, withoutMetadata } from "./imageMetadata.ts";
import { encodePng } from "./png.ts";
import { extractTextLines, type Line } from "./pdf/text.ts";
import { pyRound, pyStrip } from "./pytext.ts";
import { codePointLength } from "./text.ts";

export const EXTRACTOR: Actor = { kind: "system", label: "feedbacker extract" };

// A page counts as an image page when it has (almost) no text and one image
// covers most of it, as in rendered "current view" report pages.
export const IMAGE_PAGE_MAX_CHARS = 40;
export const IMAGE_PAGE_MIN_COVERAGE = 0.6;
// Too many image pages means the text cannot be extracted reliably.
const IMAGE_PAGES_FAIL_COUNT = 3;
const IMAGE_PAGES_FAIL_SHARE = 0.25;
/**
 * What a figure's alternative text, from its document, is introduced by, in the paragraph straight after its
 * placeholder. It never repeats the placeholder, which must be in the text exactly once.
 */
export const ALT_TEXT_PREFIX = "Alt text:";

/** An image smaller than this, in points, either way is decoration (a bullet, an icon, a rule), not a figure. */
export const MIN_FIGURE_PT = 32;

const MEDIA_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", emf: "image/x-emf", wmf: "image/x-wmf", svg: "image/svg+xml" };
/** A docx image's media type: the content type its package declares for it, if that is an image's; else from its part's name. */
export function mediaTypeOf(path: string, contentType: string | null = null): string {
  const declared = contentType?.trim().toLowerCase() ?? "";
  if (/^image\/[a-z0-9.+-]+$/.test(declared)) return declared;
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MEDIA_TYPES[ext] ?? `image/x-${ext.replace(/[^a-z0-9]/g, "") || "unknown"}`;
}

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
  throw new ExtractionError(`unsupported file type '.${suffix}'; Feedbacker extracts typed docx and pdf only`);
}

class Builder {
  text = "";
  length = 0; // in code points
  blocks: Block[] = [];
  warnings: string[] = [];
  figures: Figure[] = [];
  figureBytes = new Map<string, Uint8Array>();
  hasText = false;
  leftOut = 0; // images too small to be figures

  /**
   * A figure, marked by its placeholder; its bytes are kept when there are any. The alternative text its author gave it
   * follows it as a paragraph of the text ("Alt text: …"), so it is anonymised, reviewed and approved with the rest of
   * the text; the figure records that it has one.
   */
  figure(widthPt: number, heightPt: number, page: number | null, image: { bytes: Uint8Array; mediaType: string } | null, alt = ""): void {
    const placeholder = `[FIGURE_${this.figures.length + 1}]`;
    this.add("figure", placeholder, null, page);
    const hasAlt = pyStrip(alt) !== "";
    if (hasAlt) this.add("paragraph", `${ALT_TEXT_PREFIX} ${alt}`, null, page);
    this.figures.push({ placeholder, page, alt_text: hasAlt, width_pt: pyRound(widthPt, 1), height_pt: pyRound(heightPt, 1), media_type: image?.mediaType ?? null, sha256: image ? sha256Bytes(image.bytes) : null, bytes: image?.bytes.length ?? null });
    if (image) this.figureBytes.set(placeholder, image.bytes);
  }

  figureWarnings(): void {
    if (this.figures.length) this.warnings.push(`${this.figures.length} figure(s) marked in the text where they were, as [FIGURE_1] and so on`);
    if (this.leftOut) this.warnings.push(`${this.leftOut} small image(s) (under ${MIN_FIGURE_PT} points) left out`);
  }

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
    if (kind !== "figure") this.hasText = true;
  }
}

export async function extract(fileName: string, bytes: Uint8Array, now: Date = new Date()): Promise<Extract> {
  return (await extractWithFigures(fileName, bytes, now)).extract;
}

/** The extract, and each figure's bytes by its placeholder, for the workspace to keep beside it. */
export async function extractWithFigures(fileName: string, bytes: Uint8Array, now: Date = new Date()): Promise<{ extract: Extract; figures: Map<string, Uint8Array> }> {
  const format = sourceFormat(fileName);
  const digest = sha256Bytes(bytes);
  const builder = new Builder();
  if (format === "docx") await extractDocx(bytes, builder);
  else await extractPdf(bytes, builder);
  if (!builder.hasText) throw new ExtractionError("no text could be extracted; the file may be empty or image-only");
  const extract = Extract.parse({
    text: builder.text,
    source_sha256: digest,
    blocks: builder.blocks,
    warnings: builder.warnings,
    figures: builder.figures,
    provenance: {
      source: `file:sha256:${digest}`,
      transformation: "extracted",
      actor: EXTRACTOR,
      timestamp: now.toISOString(),
      input_hashes: [digest],
    },
  });
  return { extract, figures: builder.figureBytes };
}

// --- DOCX -------------------------------------------------------------------------

async function extractDocx(bytes: Uint8Array, out: Builder): Promise<void> {
  let content;
  try {
    content = await readDocx(bytes);
  } catch (err) {
    throw new ExtractionError(`the docx file could not be read: ${(err as Error).message}`);
  }
  let missing = 0;
  let unreadable = 0;
  for (const b of content.blocks) {
    if (!b.figure) out.add(b.kind, b.text, b.level);
    else if (b.figure.widthPt < MIN_FIGURE_PT || b.figure.heightPt < MIN_FIGURE_PT) out.leftOut++;
    else if (!b.figure.path || !b.figure.bytes) missing++;
    else {
      // Kept only without its hidden metadata (a photo's location, say), so nothing the educator can't see is ever kept
      // or sent. An image with no way to remove it (its format), or that can't be read, is marked where it was, but not kept.
      const mediaType = mediaTypeOf(b.figure.path, b.figure.contentType);
      const bytes = cleanable(mediaType) ? withoutMetadata(b.figure.bytes, mediaType) : null;
      if (!bytes) unreadable++;
      out.figure(b.figure.widthPt, b.figure.heightPt, null, bytes ? { bytes, mediaType } : null, b.figure.alt);
    }
  }
  if (content.tables) out.warnings.push(`${content.tables} table(s) extracted row by row; check layout-dependent content`);
  out.figureWarnings();
  if (missing) out.warnings.push(`${missing} image(s) linked from outside the document, or missing from it, left out`);
  if (unreadable) out.warnings.push(`${unreadable} figure(s) in a format that can't be sent (such as EMF or TIFF), or that couldn't be read, marked where they were but not kept`);
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
          "Use the student's original file. Feedbacker has no OCR.",
      );
    }
    for (const [i, page] of pages.entries()) {
      const number = i + 1;
      if (imagePages.includes(number)) {
        out.warnings.push(`page ${number} is an image; its content is not extracted`);
        continue;
      }
      const lines = extractTextLines(page.chars);
      const figures = figuresOf(page, out);
      if (!lines.length && !figures.length) {
        out.warnings.push(`page ${number} is empty`);
        continue;
      }
      await addPdfLines(lines, figures, number, out);
    }
    out.figureWarnings();
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

/** A page's pictures (not stencil masks) big enough to be figures, top to bottom (then left to right); smaller pictures are counted as left out. */
function figuresOf(page: PageContent, out: Builder): ImageBox[] {
  const pictures = page.images.filter((im) => !im.mask);
  const figures = pictures.filter((im) => im.x1 - im.x0 >= MIN_FIGURE_PT && im.bottom - im.top >= MIN_FIGURE_PT);
  out.leftOut += pictures.length - figures.length;
  return figures.sort((a, b) => a.top - b.top || a.x0 - b.x0);
}

async function addPdfFigure(im: ImageBox, page: number, out: Builder): Promise<void> {
  const pixels = im.pixels ? await im.pixels() : null; // a picture pdf.js painted as a pattern has none to give
  out.figure(im.x1 - im.x0, im.bottom - im.top, page, pixels ? { bytes: encodePng(pixels.width, pixels.height, pixels.kind, pixels.data), mediaType: "image/png" } : null);
}

async function addPdfLines(lines: Line[], figures: ImageBox[], page: number, out: Builder): Promise<void> {
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

  let next = 0; // the next figure to place: before the first line below its top
  for (const line of lines) {
    if (next < figures.length && figures[next].top < line.top) {
      flush();
      while (next < figures.length && figures[next].top < line.top) await addPdfFigure(figures[next++], page, out);
      previousBottom = null;
    }
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
  while (next < figures.length) await addPdfFigure(figures[next++], page, out);
}
