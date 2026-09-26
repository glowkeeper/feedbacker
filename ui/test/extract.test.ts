/** Deterministic extraction of typed docx and pdf files. A port of `core/tests/test_extract.py`. */

import { expect, test } from "vitest";
import { extract, ExtractionError, sha256Bytes, type Extract } from "../src/core/index.ts";
import { docxWithTable, packFile, pdfPages, pdfWithImagePages } from "./builders.ts";

/** Each block's kind and text; offsets count code points, as in Python. */
const blockTexts = (e: Extract) => e.blocks.map((b) => [b.kind, [...e.text].slice(b.start, b.end).join("")] as const);
const sub = (name: string) => packFile(`submissions/${name}`);

test("docx keeps headings and paragraphs", async () => {
  const bytes = sub("sub-a.docx");
  const e = await extract("sub-a.docx", bytes);
  const blocks = blockTexts(e);
  expect(blocks[0]).toEqual(["heading", "Plant Swap: a community plant-sharing web app"]);
  expect(blocks).toContainEqual(["heading", "Implementation"]);
  expect(blocks.some(([k, t]) => k === "paragraph" && t.includes("MoSCoW"))).toBe(true);
  expect(e.source_sha256).toBe(sha256Bytes(bytes));
  expect(e.warnings).toEqual([]);
});

test("docx never reads metadata", async () => {
  // The fixture's author metadata is a fictional name that is not in the body text.
  const e = await extract("sub-c.docx", sub("sub-c.docx"));
  expect(e.text.split("Riley Marsh").length - 1).toBe(1); // only the cover line in the body
});

test("pdf keeps pages, headings and paragraphs", async () => {
  const e = await extract("sub-d.pdf", sub("sub-d.pdf"));
  expect(e.blocks.every((b) => b.page === 1)).toBe(true);
  const kinds = blockTexts(e).map(([k]) => k);
  expect(kinds).toContain("heading");
  expect(kinds).toContain("paragraph");
  expect(blockTexts(e).some(([, t]) => t.includes("WebSockets"))).toBe(true);
});

test("docx tables and footers are warned", async () => {
  const e = await extract("t.docx", docxWithTable());
  expect(blockTexts(e)).toContainEqual(["table_row", "Latency | 120 ms"]);
  expect(e.warnings.some((w) => w.includes("table(s) extracted row by row"))).toBe(true);
  expect(e.warnings).toContain("headers and footers are not extracted");
});

test("an empty pdf page is warned", async () => {
  const e = await extract("p.pdf", pdfPages(["First page text.", null, "Third page text."]));
  expect(e.warnings).toContain("page 2 is empty");
  expect(e.blocks.map((b) => b.page)).toEqual([1, 3]);
});

test("a single image page is warned, not fatal", async () => {
  const e = await extract("p.pdf", pdfWithImagePages(5, 1));
  expect(e.warnings).toContain("page 6 is an image; its content is not extracted");
});

test("the marked-view replica is rejected", async () => {
  await expect(extract("marked-view-replica.pdf", packFile("marked-view-replica.pdf"))).rejects.toThrow(
    /unsuitable for text extraction.*no OCR/,
  );
});

test("a mostly image pdf is rejected", async () => {
  await expect(extract("p.pdf", pdfWithImagePages(1, 3))).rejects.toThrow("3 of 4 pages are images");
});

test.each([
  ["x.odt", "anything", "unsupported file type '.odt'"],
  ["x.docx", "not a zip", "docx file could not be read"],
  ["x.pdf", "not a pdf", "pdf file could not be read"],
])("unreadable or unsupported files fail clearly: %s", async (name, data, message) => {
  const error = await extract(name, new TextEncoder().encode(data)).catch((e) => e);
  expect(error).toBeInstanceOf(ExtractionError);
  expect(error.message).toContain(message);
});

test("a blank pdf fails rather than returning nothing", async () => {
  await expect(extract("p.pdf", pdfPages([null, null]))).rejects.toThrow("no text could be extracted");
});

// --- Beyond the Python tests ------------------------------------------------------

test("offsets count code points, so blocks after an emoji still line up", async () => {
  const { docx, para } = await import("./builders.ts");
  const e = await extract("u.docx", docx({ body: para("Zoë wrote 🙂 this.") + para("Second paragraph.") }));
  expect(blockTexts(e)).toEqual([
    ["paragraph", "Zoë wrote 🙂 this."],
    ["paragraph", "Second paragraph."],
  ]);
  expect(e.blocks[1].start).toBe(19); // 17 code points + "\n\n" (JavaScript's .length would say 20)
});

test("the extract is a valid contract record, with provenance", async () => {
  const e = await extract("sub-a.docx", sub("sub-a.docx"), new Date("2026-01-15T09:00:00Z"));
  expect(e.provenance).toMatchObject({
    transformation: "extracted",
    actor: { kind: "system", label: "feedbacker extract" },
    timestamp: "2026-01-15T09:00:00Z",
    input_hashes: [e.source_sha256],
  });
});
