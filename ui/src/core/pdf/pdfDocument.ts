/** Opening a PDF with pdf.js, for extraction and inspection. */

import { getDocument, type PDFDocumentProxy } from "#pdfjs";
import { readPage, type PageContent } from "./page.ts";

// The document information entries a PDF itself can carry; pdf.js adds its
// own keys (such as PDFFormatVersion) alongside them, which are not metadata.
const INFO_KEYS = ["Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate", "Trapped"];

export class PdfDocument {
  readonly #pdf: PDFDocumentProxy;
  readonly #destroy: () => Promise<void>;

  private constructor(pdf: PDFDocumentProxy, destroy: () => Promise<void>) {
    this.#pdf = pdf;
    this.#destroy = destroy;
  }

  /** Throws the pdf.js error (e.g. InvalidPDFException) if the file can't be read. */
  static async open(bytes: Uint8Array): Promise<PdfDocument> {
    // pdf.js takes ownership of the buffer it is given, so pass a copy.
    const task = getDocument({ data: bytes.slice(), verbosity: 0 });
    try {
      return new PdfDocument(await task.promise, () => task.destroy());
    } catch (err) {
      await task.destroy();
      throw err;
    }
  }

  get pageCount(): number {
    return this.#pdf.numPages;
  }

  async page(n: number): Promise<PageContent> {
    return readPage(await this.#pdf.getPage(n));
  }

  /** The names (never the values) of the document information entries present, sorted. */
  async metadataKeys(): Promise<string[]> {
    const { info } = (await this.#pdf.getMetadata()) as unknown as { info: Record<string, unknown> };
    const keys = INFO_KEYS.filter((k) => info[k] !== undefined && info[k] !== null);
    const custom = (info.Custom as Record<string, unknown> | undefined) ?? {};
    return [...keys, ...Object.keys(custom)].sort();
  }

  /** The subtype of each annotation on a page (e.g. "Link", "Text"). */
  async annotationTypes(n: number): Promise<string[]> {
    const annotations = await (await this.#pdf.getPage(n)).getAnnotations();
    return annotations.map((a: { subtype?: string }) => a.subtype ?? "?");
  }

  close(): Promise<void> {
    return this.#destroy();
  }
}
