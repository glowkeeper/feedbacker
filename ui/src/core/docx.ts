/**
 * Reading typed .docx files (#47), following python-docx 1.2's rules so that
 * the text and blocks match the Python reference exactly:
 *
 * - The body's direct paragraphs and tables, in order. A paragraph's text is
 *   its runs and hyperlinks: `w:t` text, `w:tab`/`w:ptab` as a tab, `w:cr`
 *   and text-wrapping `w:br` as a newline, `w:noBreakHyphen` as "-".
 * - Heading levels come from style names ("Title" is 0, "Heading n" is n).
 * - A table row's cells repeat across horizontal spans, and a vertically
 *   merged cell takes the text of the cell above.
 * - Images are counted as python-docx counts inline shapes.
 * - Headers and footers are checked per section, as python-docx sees them.
 *
 * Document properties (author and so on) are never read when extracting.
 * The library decision (#47): the zip and XML are read directly with fflate
 * and saxes, rather than a docx-to-HTML converter such as mammoth, whose
 * output would have to be parsed again and loses table structure.
 */

import { pySplit, pyStrip } from "./pytext.ts";
import { attr, childOf, childrenOf, descendants, elements, ownText, parseXml, type XmlElement } from "./xml.ts";
import { bytesSource, listZip, readMember, type ZipEntry } from "./zip.ts";

export const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const DC = "http://purl.org/dc/elements/1.1/";
const CP = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";

export class DocxError extends Error {}

export interface DocxBlock {
  kind: "heading" | "paragraph" | "table_row";
  text: string;
  level: number | null;
}

/** A .docx package: its parts, read only when asked for. */
export class DocxPackage {
  readonly #bytes: Uint8Array;
  readonly #entries: Map<string, ZipEntry>;

  private constructor(bytes: Uint8Array, entries: ZipEntry[]) {
    this.#bytes = bytes;
    this.#entries = new Map(entries.map((e) => [e.name, e]));
  }

  static async open(bytes: Uint8Array): Promise<DocxPackage> {
    try {
      return new DocxPackage(bytes, await listZip(bytesSource("package.docx", bytes)));
    } catch (err) {
      throw new DocxError(`not a docx package (${(err as Error).message})`);
    }
  }

  async xml(path: string): Promise<XmlElement | null> {
    const entry = this.#entries.get(path);
    if (!entry) return null;
    const data = await readMember(bytesSource("package.docx", this.#bytes), entry);
    return parseXml(new TextDecoder().decode(data));
  }

  /** Relationships of a part: id -> { type, target resolved to a package path }. */
  async relationships(partPath: string): Promise<Map<string, { type: string; target: string }>> {
    const slash = partPath.lastIndexOf("/");
    const dir = partPath.slice(0, slash + 1);
    const rels = await this.xml(`${dir}_rels/${partPath.slice(slash + 1)}.rels`);
    const out = new Map<string, { type: string; target: string }>();
    for (const rel of rels ? childrenOf(rels, PKG_REL, "Relationship") : []) {
      if (rel.attrs.get("TargetMode") === "External") continue;
      const target = rel.attrs.get("Target") ?? "";
      out.set(rel.attrs.get("Id") ?? "", { type: rel.attrs.get("Type") ?? "", target: resolve(dir, target) });
    }
    return out;
  }

  async mainDocumentPath(): Promise<string> {
    for (const { type, target } of (await this.relationships("")).values()) {
      if (type.endsWith("/officeDocument")) return target;
    }
    throw new DocxError("the package has no main document");
  }
}

function resolve(dir: string, target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : dir + target).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

// --- Text, as python-docx gives it -------------------------------------------------

function runText(r: XmlElement): string {
  let text = "";
  for (const e of elements(r)) {
    if (e.ns !== W) continue;
    if (e.local === "t") text += ownText(e);
    else if (e.local === "tab" || e.local === "ptab") text += "\t";
    else if (e.local === "cr") text += "\n";
    else if (e.local === "noBreakHyphen") text += "-";
    else if (e.local === "br") text += (attr(e, W, "type") ?? "textWrapping") === "textWrapping" ? "\n" : "";
  }
  return text;
}

export function paragraphText(p: XmlElement): string {
  let text = "";
  for (const e of elements(p)) {
    if (e.ns !== W) continue;
    if (e.local === "r") text += runText(e);
    else if (e.local === "hyperlink") text += childrenOf(e, W, "r").map(runText).join("");
  }
  return text;
}

// --- Styles --------------------------------------------------------------------

export interface Styles {
  /** The paragraph's style name, or the default paragraph style's. */
  nameOf(p: XmlElement): string;
}

export async function readStyles(pkg: DocxPackage, documentPath: string): Promise<Styles> {
  const names = new Map<string, string>();
  let defaultName = "Normal";
  for (const { type, target } of (await pkg.relationships(documentPath)).values()) {
    if (!type.endsWith("/styles")) continue;
    const styles = await pkg.xml(target);
    for (const s of styles ? childrenOf(styles, W, "style") : []) {
      if (attr(s, W, "type") !== "paragraph") continue;
      const name = attr(childOf(s, W, "name") ?? s, W, "val") ?? "";
      const id = attr(s, W, "styleId");
      if (id) names.set(id, name);
      if (["1", "true", "on"].includes(attr(s, W, "default") ?? "")) defaultName = name;
    }
  }
  return {
    nameOf(p) {
      const id = attr(childOf(childOf(p, W, "pPr") ?? p, W, "pStyle") ?? p, W, "val");
      return (id !== null && names.get(id)) || defaultName;
    },
  };
}

/** "Title" is level 0; "Heading n" is level n ("Heading" alone is 1); anything else is body text. */
export function headingLevel(styleName: string): number | null {
  const name = styleName.toLowerCase();
  if (name === "title") return 0;
  if (name.startsWith("heading")) {
    const digits = pyStrip(name.slice("heading".length));
    return /^[0-9]+$/.test(digits) ? Number(digits) : 1;
  }
  return null;
}

// --- Tables --------------------------------------------------------------------------

const gridSpan = (tc: XmlElement) => Number(attr(childOf(childOf(tc, W, "tcPr") ?? tc, W, "gridSpan") ?? tc, W, "val") ?? 1) || 1;
const gridBefore = (tr: XmlElement) => Number(attr(childOf(childOf(tr, W, "trPr") ?? tr, W, "gridBefore") ?? tr, W, "val") ?? 0) || 0;

/** "continue" when this cell continues a vertical merge (the default when w:vMerge has no value). */
function vMerge(tc: XmlElement): string | null {
  const merge = childOf(childOf(tc, W, "tcPr") ?? tc, W, "vMerge");
  return merge ? (attr(merge, W, "val") ?? "continue") : null;
}

/** The text of each layout-grid cell in a row, as python-docx's `_Row.cells`. */
function rowCellTexts(rows: XmlElement[], rowIndex: number): string[] {
  const offsetOf = (tr: XmlElement, tc: XmlElement) => {
    let offset = gridBefore(tr);
    for (const other of childrenOf(tr, W, "tc")) {
      if (other === tc) return offset;
      offset += gridSpan(other);
    }
    return offset;
  };
  const tcAt = (tr: XmlElement, offset: number): XmlElement => {
    let remaining = offset - gridBefore(tr);
    for (const tc of childrenOf(tr, W, "tc")) {
      if (remaining < 0) break;
      if (remaining === 0) return tc;
      remaining -= gridSpan(tc);
    }
    throw new DocxError("a merged table cell has no cell above it");
  };
  const cellsOf = (index: number, tc: XmlElement): string[] => {
    if (vMerge(tc) === "continue") {
      if (index === 0) throw new DocxError("a merged table cell has no row above it");
      return cellsOf(index - 1, tcAt(rows[index - 1], offsetOf(rows[index], tc)));
    }
    const text = childrenOf(tc, W, "p").map(paragraphText).join("\n");
    return Array(gridSpan(tc)).fill(text);
  };
  return childrenOf(rows[rowIndex], W, "tc").flatMap((tc) => cellsOf(rowIndex, tc));
}

// --- Reading a document ----------------------------------------------------------------

export interface DocxContent {
  blocks: DocxBlock[];
  tables: number;
  images: number;
  headerFooterText: boolean;
}

interface Parts {
  pkg: DocxPackage;
  documentPath: string;
  body: XmlElement;
  styles: Styles;
}

async function openParts(bytes: Uint8Array): Promise<Parts> {
  const pkg = await DocxPackage.open(bytes);
  const documentPath = await pkg.mainDocumentPath();
  const main = await pkg.xml(documentPath);
  const body = main && childOf(main, W, "body");
  if (!body) throw new DocxError("the main document has no body");
  return { pkg, documentPath, body, styles: await readStyles(pkg, documentPath) };
}

/** Every section's header and footer paragraphs, inheriting from earlier sections as python-docx does. */
async function headerFooterParagraphs(parts: Parts): Promise<XmlElement[]> {
  const { pkg, documentPath, body } = parts;
  const rels = await pkg.relationships(documentPath);
  const sections = [
    ...childrenOf(body, W, "p").flatMap((p) => {
      const pPr = childOf(p, W, "pPr");
      return pPr ? childrenOf(pPr, W, "sectPr") : [];
    }),
    ...childrenOf(body, W, "sectPr"),
  ];
  const prior: Record<string, string | null> = { headerReference: null, footerReference: null };
  const out: XmlElement[] = [];
  for (const sectPr of sections) {
    for (const kind of ["headerReference", "footerReference"]) {
      const ref = childrenOf(sectPr, W, kind).find((r) => (attr(r, W, "type") ?? "default") === "default");
      if (ref) prior[kind] = rels.get(attr(ref, R, "id") ?? "")?.target ?? null;
      const part = prior[kind] ? await pkg.xml(prior[kind]!) : null;
      if (part) out.push(...childrenOf(part, W, "p"));
    }
  }
  return out;
}

export async function readDocx(bytes: Uint8Array): Promise<DocxContent> {
  const parts = await openParts(bytes);
  const { body, styles } = parts;
  const blocks: DocxBlock[] = [];
  let tables = 0;
  for (const child of elements(body)) {
    if (child.ns !== W) continue;
    if (child.local === "p") {
      const level = headingLevel(styles.nameOf(child));
      blocks.push({ kind: level === null ? "paragraph" : "heading", text: paragraphText(child), level });
    } else if (child.local === "tbl") {
      tables++;
      const rows = childrenOf(child, W, "tr");
      rows.forEach((_, i) => {
        const cells: string[] = [];
        for (const raw of rowCellTexts(rows, i)) {
          const text = pySplit(raw).join(" ");
          if (!cells.length || cells.at(-1) !== text) cells.push(text); // merged cells repeat
        }
        blocks.push({ kind: "table_row", text: cells.join(" | "), level: null });
      });
    }
  }
  const images = countInlineShapes(body);
  const headerFooterText = (await headerFooterParagraphs(parts)).some((p) => pyStrip(paragraphText(p)) !== "");
  return { blocks, tables, images, headerFooterText };
}

/** As python-docx's `inline_shapes`: `//w:p/w:r/w:drawing/wp:inline`. */
function countInlineShapes(body: XmlElement): number {
  let n = 0;
  for (const p of descendants(body, W, "p")) {
    for (const r of childrenOf(p, W, "r")) {
      for (const drawing of childrenOf(r, W, "drawing")) n += childrenOf(drawing, WP, "inline").length;
    }
  }
  return n;
}

// --- Inspection (structure only) ------------------------------------------------------------

export interface DocxStructure {
  paragraphs: number;
  words: number;
  tables: number;
  images: number;
  sections: number;
  styleKinds: [string, number][];
  headerFooterParagraphs: number;
  metadataFilled: string[];
}

function styleBucket(name: string): string {
  const n = name.toLowerCase();
  if (n === "title") return "title";
  if (n.startsWith("heading")) return "heading";
  if (n.includes("list")) return "list";
  if (["normal", "body text", "first paragraph", "compact", "default paragraph style"].includes(n)) return "body";
  return "other";
}

/** Counts and kinds only: never text, style names, or metadata values. */
export async function inspectDocxStructure(bytes: Uint8Array): Promise<DocxStructure> {
  const parts = await openParts(bytes);
  const { pkg, body, styles } = parts;
  const paragraphs = childrenOf(body, W, "p");
  const buckets = new Map<string, number>();
  for (const p of paragraphs) {
    const bucket = styleBucket(styles.nameOf(p));
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  const sections =
    paragraphs.filter((p) => childOf(childOf(p, W, "pPr") ?? p, W, "sectPr")).length + childrenOf(body, W, "sectPr").length;
  const core = await pkg.xml("docProps/core.xml");
  const filled: string[] = [];
  const props: [string, string, string][] = [
    ["author", DC, "creator"],
    ["last_modified_by", CP, "lastModifiedBy"],
    ["title", DC, "title"],
    ["subject", DC, "subject"],
    ["keywords", CP, "keywords"],
    ["comments", DC, "description"],
  ];
  for (const [name, ns, local] of props) {
    const e = core && childOf(core, ns, local);
    if (e && ownText(e) !== "") filled.push(name);
  }
  return {
    paragraphs: paragraphs.length,
    words: paragraphs.reduce((n, p) => n + pySplit(paragraphText(p)).length, 0),
    tables: childrenOf(body, W, "tbl").length,
    images: countInlineShapes(body),
    sections,
    // Most common first, ties in first-seen order, as Python's Counter.most_common.
    styleKinds: [...buckets.entries()].sort((a, b) => b[1] - a[1]),
    headerFooterParagraphs: (await headerFooterParagraphs(parts)).filter((p) => pyStrip(paragraphText(p)) !== "").length,
    metadataFilled: filled,
  };
}
