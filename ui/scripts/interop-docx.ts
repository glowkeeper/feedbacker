/**
 * Check the summary's Word document with an independent reader (#20):
 * python-docx, which the Python core already uses to read documents, opens
 * the docx written for the synthetic example record and reports its
 * structure. It must find each heading in its Word heading style, each table
 * with its header row marked, the lists as list paragraphs, and a title and
 * language but no author in the properties.
 *
 *   node scripts/interop-docx.ts       (needs uv and the core environment)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ModerationRecord, summaryBlocks, writeDocx } from "../src/core/index.ts";
import { PACK } from "../test/builders.ts";
import { tempDir } from "../test/proxyHarness.ts";

let failures = 0;
const check = (what: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${!ok && detail ? `: ${detail}` : ""}`);
};

const record = ModerationRecord.parse(JSON.parse(readFileSync(new URL("moderation-record.example.json", PACK), "utf8")));
const blocks = summaryBlocks(record);
const dir = tempDir();
const path = join(dir, "summary.docx");
writeFileSync(path, writeDocx(blocks, "Moderation summary: example"));

const report = JSON.parse(
  execFileSync(
    "uv",
    [
      "run",
      "--quiet",
      "--project",
      "../core",
      "python",
      "-c",
      `
import json, sys
import docx
from docx.oxml.ns import qn
d = docx.Document(sys.argv[1])
tables = []
for t in d.tables:
    tr = t.rows[0]._tr
    tables.append({"header": tr.trPr is not None and tr.trPr.find(qn("w:tblHeader")) is not None,
                   "later_headers": sum(1 for r in t.rows[1:] if r._tr.trPr is not None and r._tr.trPr.find(qn("w:tblHeader")) is not None),
                   "head": [c.text for c in t.rows[0].cells], "rows": len(t.rows) - 1})
cp = d.core_properties
print(json.dumps({
  "headings": [[p.style.name, p.text] for p in d.paragraphs if p.style.name.startswith("Heading")],
  "tables": tables,
  "list_items": sum(1 for p in d.paragraphs if p.style.name == "List Paragraph" and p._p.pPr is not None and p._p.pPr.numPr is not None),
  "title": cp.title, "language": cp.language, "author": cp.author, "last_modified_by": cp.last_modified_by,
}))
`,
      path,
    ],
    { encoding: "utf8" },
  ),
);

const headings = blocks.flatMap((b) => (b.kind === "heading" ? [[`Heading ${b.level}`, b.text]] : []));
check("python-docx finds every heading in its Word heading style, in order", isDeepStrictEqual(report.headings, headings), JSON.stringify(report.headings));
const tables = blocks.flatMap((b) => (b.kind === "table" ? [{ header: true, later_headers: 0, head: b.head, rows: b.rows.length }] : []));
check("python-docx finds every table, each with one header row marked as a header", isDeepStrictEqual(report.tables, tables), JSON.stringify(report.tables));
const items = blocks.reduce((n, b) => n + (b.kind === "list" ? b.items.length : 0), 0);
check("python-docx finds every list item as a bulleted list paragraph", report.list_items === items, `${report.list_items} of ${items}`);
check(
  "the properties give a title and the language, and no author",
  report.title === "Moderation summary: example" && report.language === "en-GB" && !report.author && !report.last_modified_by,
  JSON.stringify([report.title, report.language, report.author, report.last_modified_by]),
);

rmSync(dir, { recursive: true, force: true });
if (failures) process.exit(1);
