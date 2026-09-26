/**
 * Builders for awkward test documents, as `core/tests/helpers.py` builds them
 * with python-docx and reportlab. Everything is fictional.
 */

import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";

export const PACK = new URL("../../fixtures/synthetic/pack-01/", import.meta.url);
export const packFile = (name: string) => new Uint8Array(readFileSync(new URL(name, PACK)));

export function makeZip(members: Record<string, Uint8Array | string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(members)) entries[name] = typeof data === "string" ? strToU8(data) : data;
  return zipSync(entries);
}

// --- docx ---------------------------------------------------------------------------

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const para = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`;

export const table = (rows: string[][]) =>
  `<w:tbl><w:tblGrid>${rows[0].map(() => "<w:gridCol/>").join("")}</w:tblGrid>${rows
    .map((r) => `<w:tr>${r.map((c) => `<w:tc>${para(c)}</w:tc>`).join("")}</w:tr>`)
    .join("")}</w:tbl>`;

const STYLES = [
  ["Normal", "Normal", true],
  ["Title", "Title", false],
  ["Heading1", "heading 1", false],
  ["Heading2", "heading 2", false],
] as const;

/** A minimal .docx: the body XML, optional extra paragraph styles, footer text, and core properties. */
export function docx(options: {
  body: string;
  extraStyles?: [id: string, name: string][];
  footer?: string;
  author?: string;
  sectPrExtra?: string;
}): Uint8Array {
  const styles = [...STYLES, ...(options.extraStyles ?? []).map(([id, name]) => [id, name, false] as const)];
  const footerRel = options.footer
    ? '<Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
    : "";
  const sectPr = `<w:sectPr>${options.footer ? '<w:footerReference w:type="default" r:id="rIdF"/>' : ""}${options.sectPrExtra ?? ""}</w:sectPr>`;
  const members: Record<string, string> = {
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${footerRel}</Relationships>`,
    "word/styles.xml": `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W_NS}>${styles
      .map(([id, name, isDefault]) => `<w:style w:type="paragraph"${isDefault ? ' w:default="1"' : ""} w:styleId="${id}"><w:name w:val="${name}"/></w:style>`)
      .join("")}</w:styles>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ${W_NS}><w:body>${options.body}${sectPr}</w:body></w:document>`,
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>${escape(options.author ?? "")}</dc:creator></cp:coreProperties>`,
  };
  if (options.footer) {
    members["word/footer1.xml"] = `<?xml version="1.0" encoding="UTF-8"?><w:ftr ${W_NS}>${para(options.footer)}</w:ftr>`;
  }
  return makeZip(members);
}

/** As helpers.docx_with_table: a heading, a paragraph, a 2x2 table, and a footer. */
export const docxWithTable = () =>
  docx({
    body:
      para("Fictional report", "Heading1") +
      para("An introduction paragraph.") +
      table([
        ["Metric", "Value"],
        ["Latency", "120 ms"],
      ]),
    footer: "Fictional footer",
  });

// --- pdf ----------------------------------------------------------------------------

/** Assemble a PDF from object bodies (binary-safe: strings are Latin-1). */
function pdf(objects: (string | Uint8Array)[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? Uint8Array.from(part, (c) => c.charCodeAt(0)) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  push("%PDF-1.4\n");
  const offsets = objects.map((body, i) => {
    const offset = length;
    push(`${i + 1} 0 obj\n`);
    push(body);
    push("\nendobj\n");
    return offset;
  });
  const xref = length;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  push(offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join(""));
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const stream = (content: string | Uint8Array, dict = "") =>
  typeof content === "string"
    ? `<< /Length ${content.length} ${dict}>>\nstream\n${content}\nendstream`
    : Uint8Array.from([...`<< /Length ${content.length} ${dict}>>\nstream\n`].map((c) => c.charCodeAt(0)).concat([...content], [...`\nendstream`].map((c) => c.charCodeAt(0))));

type PageSpec = { text?: string | null; image?: boolean };

function pdfOf(pages: PageSpec[]): Uint8Array {
  // 1 catalog, 2 pages, 3 font, 4 image, then a content stream and a page per page.
  const objects: (string | Uint8Array)[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    stream(new Uint8Array(16).fill(255), "/Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceGray /BitsPerComponent 8 "),
  ];
  const kids: number[] = [];
  for (const page of pages) {
    let content = "";
    if (page.text) {
      content = page.text
        .split("\n")
        .map((line, i) => `BT /F1 11 Tf 60 ${780 - i * 16} Td (${line.replace(/[\\()]/g, (c) => `\\${c}`)}) Tj ET`)
        .join("\n");
    }
    // As reportlab's drawImage(20, 20, width - 40, height - 40) on A4.
    if (page.image) content += `\nq 555.2756 0 0 801.8898 20 20 cm /Im1 Do Q`;
    objects.push(stream(content));
    const contentRef = objects.length;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.2756 841.8898] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${contentRef} 0 R >>`,
    );
    kids.push(objects.length);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  return pdf(objects);
}

/** As helpers.pdf_pages: text pages; null is a blank page. */
export const pdfPages = (pages: (string | null)[]) => pdfOf(pages.map((text) => ({ text })));

/** As helpers.pdf_with_image_pages: typed pages, then full-page images. */
export const pdfWithImagePages = (textPages: number, imagePages: number) =>
  pdfOf([
    ...Array.from({ length: textPages }, (_, i) => ({ text: `Fictional typed paragraph on page ${i + 1}.` })),
    ...Array.from({ length: imagePages }, () => ({ image: true })),
  ]);
