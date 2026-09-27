/**
 * Write a summary outline (summary.ts) as a Word document (.docx), built to
 * be accessible:
 *
 * - headings use Word's Heading 1 to 4 styles (with outline levels), so the
 *   navigation pane and screen readers see the structure;
 * - each table has a caption (its accessible description) and a header row
 *   marked as one, which Word repeats on each page and announces;
 * - lists are real bulleted lists;
 * - the document's language is en-GB, and its title is in its properties;
 * - no author or other personal metadata is written.
 *
 * A .docx is a zip of XML parts; this writes the few a document needs, with
 * a fixed modification time, so the same outline always gives the same bytes.
 */

import { strToU8, zipSync } from "fflate";
import type { Run, SummaryBlock } from "./summary.ts";

/** Text without the characters XML can't hold: control characters, U+FFFE and U+FFFF, and lone surrogates. */
const strip = (text: string) =>
  text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
/** Text as XML character data, with markup escaped. */
const xml = (text: string) => strip(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const oneLine = (text: string) => strip(text).replace(/\s+/g, " ").trim();
const run = (r: Run, bold = false) => {
  const props = [bold ? "<w:b/>" : "", typeof r === "string" ? "" : '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>'].join("");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(typeof r === "string" ? strip(r).replace(/\s+/g, " ") : r.code)}</w:t></w:r>`;
};
const paragraph = (runs: string, style?: string, extra = "") =>
  `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>` : ""}${runs}</w:p>`;

function block(b: SummaryBlock): string {
  switch (b.kind) {
    case "heading":
      return paragraph(run(oneLine(b.text)), `Heading${b.level}`);
    case "paragraph":
      // Each line in turn, separated by a line break, as the Markdown's lines are.
      return paragraph(b.lines.map((runs, i) => (i ? "<w:r><w:br/></w:r>" : "") + runs.map((r) => run(r)).join("")).join(""));
    case "list":
      return b.items.map((item) => paragraph(run(oneLine(item)), "ListParagraph", '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')).join("");
    case "table": {
      const cells = (row: string[], header: boolean) =>
        row.map((c) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${paragraph(run(oneLine(c), header), undefined, '<w:spacing w:before="0" w:after="0"/>')}</w:tc>`).join("");
      return (
        "<w:tbl><w:tblPr>" +
        '<w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/>' +
        `<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>` +
        `<w:tblCaption w:val="${xml(oneLine(b.caption))}"/>` +
        "</w:tblPr>" +
        `<w:tblGrid>${b.head.map(() => "<w:gridCol/>").join("")}</w:tblGrid>` +
        `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${cells(b.head, true)}</w:tr>` +
        b.rows.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells(r, false)}</w:tr>`).join("") +
        "</w:tbl>" +
        // Word needs a paragraph between two tables, and this keeps a table from running into what follows.
        paragraph("")
      );
    }
  }
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB" w:eastAsia="en-GB" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${[1, 2, 3, 4]
  .map(
    (n) =>
      `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${n === 1 ? 240 : 200}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${[40, 32, 28, 24][n - 1]}"/><w:szCs w:val="${[40, 32, 28, 24][n - 1]}"/></w:rPr></w:style>`,
  )
  .join("\n")}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

const PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;

/** The outline as a .docx, titled `title`. */
export function writeDocx(blocks: SummaryBlock[], title: string): Uint8Array {
  const body = blocks.map(block).join("");
  const main = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  // A title and language only: no creator, no revision history, no dates that could identify anyone.
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(oneLine(title))}</dc:title><dc:language>en-GB</dc:language></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Feedbacker</Application></Properties>`;
  return zipSync(
    {
      "[Content_Types].xml": strToU8(CONTENT_TYPES),
      "_rels/.rels": strToU8(PACKAGE_RELS),
      "word/document.xml": strToU8(main),
      "word/_rels/document.xml.rels": strToU8(DOCUMENT_RELS),
      "word/styles.xml": strToU8(STYLES),
      "word/numbering.xml": strToU8(NUMBERING),
      "docProps/core.xml": strToU8(core),
      "docProps/app.xml": strToU8(app),
    },
    { mtime: new Date("1980-01-01T00:00:00Z") },
  );
}
