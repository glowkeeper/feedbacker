/** The summary as a Word document: the same outline as the Markdown, accessible structure, and nothing personal in its metadata. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { beforeEach, expect, test } from "vitest";
import { approveRecord, exportSummaryDocx, extract, recordVerdict, RecordNotReady, summaryBlocks, writeDocx, type Rubric, type Workspace } from "../src/core/index.ts";
import { at, REAL, reviewBoth, setUpModeration } from "./moderation.ts";

let ws: Workspace;
let path: string;
let rubric: Rubric;

beforeEach(async () => {
  ({ ws, path, rubric } = await setUpModeration("mod-docx"));
  await reviewBoth(ws, rubric);
});

const parts = (bytes: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]));

test("the Word document says what the Markdown says, and reads back as the same outline", async () => {
  const record = await approveRecord(ws, { overallComment: "Marking was broadly consistent.", now: at(20) });
  const { path: exported, bytes } = await exportSummaryDocx(ws, at(25));
  expect(exported).toBe("exports/mod-docx-summary.feedbacker-export.docx");
  expect(new Uint8Array(readFileSync(join(path, exported)))).toEqual(bytes);

  // Feedbacker's own docx reader finds every heading, at its level, and every table's text.
  const read = await extract("summary.docx", bytes);
  const blocks = summaryBlocks(record);
  const headings = read.blocks.filter((b) => b.kind === "heading").map((b) => [b.level, read.text.slice(b.start, b.end)]);
  expect(headings).toEqual(blocks.filter((b) => b.kind === "heading").map((b) => [b.level, b.text]));
  for (const b of blocks.filter((x) => x.kind === "table")) {
    for (const row of [b.head, ...b.rows]) for (const cell of row) expect(read.text).toContain(cell.replace(/\s+/g, " ").trim());
  }
  expect(read.text).toContain("Marking was broadly consistent.");
  expect(read.text).not.toMatch(REAL);
});

test("its structure is accessible: heading styles, table captions and header rows, real lists, en-GB", async () => {
  const record = await approveRecord(ws, { now: at(20) });
  const blocks = summaryBlocks(record);
  const p = parts(writeDocx(blocks, "Moderation summary: Fictional 101"));
  const doc = p["word/document.xml"];
  expect((doc.match(/<w:pStyle w:val="Heading\d"\/>/g) ?? []).length).toBe(blocks.filter((b) => b.kind === "heading").length);
  const tables = blocks.filter((b) => b.kind === "table");
  expect((doc.match(/<w:tbl>/g) ?? []).length).toBe(tables.length);
  expect((doc.match(/<w:tblHeader\/>/g) ?? []).length).toBe(tables.length); // one header row per table
  for (const t of tables) expect(doc).toContain(`<w:tblCaption w:val="${t.caption}"/>`);
  expect((doc.match(/<w:numId w:val="1"\/>/g) ?? []).length).toBe(blocks.flatMap((b) => (b.kind === "list" ? b.items : [])).length);
  for (const n of [1, 2, 3, 4]) expect(p["word/styles.xml"]).toContain(`<w:outlineLvl w:val="${n - 1}"/>`);
  expect(p["word/styles.xml"]).toContain('<w:lang w:val="en-GB"');
  expect(p["docProps/core.xml"]).toContain("<dc:title>Moderation summary: Fictional 101</dc:title>");
  expect(p["docProps/core.xml"]).toContain("<dc:language>en-GB</dc:language>");
  expect(p["docProps/core.xml"]).not.toMatch(/creator|lastModifiedBy|created|modified/);
});

test("the same record always gives the same bytes, and text can't break the XML", async () => {
  const record = await approveRecord(ws, { overallComment: 'A & B < C > "D" \u0001 end', now: at(20) });
  const a = writeDocx(summaryBlocks(record), "t");
  expect(writeDocx(summaryBlocks(record), "t")).toEqual(a);
  const read = await extract("summary.docx", a);
  console.log("OVERALL", JSON.stringify(read.text.slice(read.text.indexOf("Overall moderator"), read.text.indexOf("Overall moderator") + 80)));
  expect(read.text).toContain('A & B < C > "D" end');
});

test("the Word document is exported only while the workspace matches the approval", async () => {
  await expect(exportSummaryDocx(ws)).rejects.toThrow("hasn't been approved");
  await approveRecord(ws, { now: at(20) });
  await recordVerdict(ws, "sub-002", { verdict: "harsh" });
  await expect(exportSummaryDocx(ws)).rejects.toThrow(RecordNotReady);
});
