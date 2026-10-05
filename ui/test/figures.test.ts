/**
 * Figures: extracted locally from docx and PDF submissions, each marked in the text by its placeholder where it was,
 * kept in the workspace's private area beside the record, and never redacted by anonymisation. Synthetic material only
 * (the pack's reports with charts).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  AnonymisationRules,
  apply,
  bytesSource,
  detect,
  encodePng,
  extractWithFigures,
  figurePath,
  importCohort,
  loadSubmission,
  PIXELS,
  PseudonymKey,
  readFigure,
  sha256Bytes,
} from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

const report = (ext: "docx" | "pdf") => packFile(`figures/report-with-figures.${ext}`);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

test("a docx's figures are marked after the paragraph or table row they are in, in order, as their own files; a tiny icon is left out", async () => {
  const { extract, figures } = await extractWithFigures("report.docx", report("docx"));
  expect(extract.text).toBe("Fictional dashboard report\n\nThe dashboard shows weekly sign-ups.\n\n[FIGURE_1]\n\nFigure 1 shows the trend.\n\nA bullet icon:\n\nChart |\n\n[FIGURE_2]\n\nThe end of the report.");
  expect(extract.blocks.filter((b) => b.kind === "figure").map((b) => [b.start, b.end])).toEqual([[66, 76], [130, 140]]);
  expect(extract.figures.map((f) => [f.placeholder, f.page, f.width_pt, f.height_pt, f.media_type])).toEqual([["[FIGURE_1]", null, 240, 160, "image/png"], ["[FIGURE_2]", null, 120, 80, "image/jpeg"]]);
  for (const f of extract.figures) expect([sha256Bytes(figures.get(f.placeholder)!), figures.get(f.placeholder)!.length]).toEqual([f.sha256, f.bytes]);
  expect(extract.warnings).toEqual(["1 table(s) extracted row by row; check layout-dependent content", "2 figure(s) marked in the text where they were, as [FIGURE_1] and so on", "1 small image(s) (under 32 points) left out"]);
});

test("a PDF's figures are placed between the lines they sit between, numbered across pages, and kept as PNG, the same each time", async () => {
  const { extract, figures } = await extractWithFigures("report.pdf", report("pdf"));
  expect(extract.text).toBe("The dashboard shows weekly sign-ups.\n\n[FIGURE_1]\n\nFigure 1 shows the trend.\n\n[FIGURE_2]\n\nFigure 2 shows the same in grey.\n\nA tiny icon, left out.\n\n[FIGURE_3]\n\nThe last page's text.");
  expect(extract.figures.map((f) => [f.placeholder, f.page, f.width_pt, f.height_pt, f.media_type])).toEqual([["[FIGURE_1]", 1, 240, 160, "image/png"], ["[FIGURE_2]", 1, 180, 120, "image/png"], ["[FIGURE_3]", 2, 300, 200, "image/png"]]);
  for (const bytes of figures.values()) expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  expect((await extractWithFigures("report.pdf", report("pdf"))).extract.figures.map((f) => f.sha256)).toEqual(extract.figures.map((f) => f.sha256));
  expect(extract.warnings).toEqual(["3 figure(s) marked in the text where they were, as [FIGURE_1] and so on", "1 small image(s) (under 32 points) left out"]);
});

test("PNG encoding: the signature, the image's size, and the same bytes for the same pixels", () => {
  const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]); // 2×2
  const png = encodePng(2, 2, PIXELS.RGB, rgb);
  const view = new DataView(png.buffer);
  expect([[...png.subarray(0, 8)], view.getUint32(16), view.getUint32(20), png[25]]).toEqual([PNG_SIGNATURE, 2, 2, 2]);
  expect(sha256Bytes(encodePng(2, 2, PIXELS.RGB, rgb))).toBe(sha256Bytes(png));
  expect(() => encodePng(3, 2, PIXELS.RGB, rgb)).toThrow("the image's pixels are short");
});

test("importing keeps each figure in the private area, checked against the record when read; importing again replaces them", async () => {
  const made = await newWorkspace("figures-1", { workspace_type: "marking" });
  const { ws, path } = made;
  await importCohort(ws, bytesSource("cohort.zip", makeZip({ "100200301 - QUILL AVERY . - report.docx": report("docx"), "100200302 - PIKE JORDAN - report.pdf": report("pdf") })));
  const docx = await loadSubmission(ws, "sub-001");
  const [first] = docx.extract!.figures;
  expect(figurePath("sub-001", first)).toBe("private/figures/sub-001/FIGURE_1.png");
  expect(sha256Bytes(await readFigure(ws, "sub-001", first))).toBe(first.sha256);
  const pdf = await loadSubmission(ws, "sub-002");
  expect(pdf.extract!.figures.map((f) => figurePath("sub-002", f))).toEqual(["private/figures/sub-002/FIGURE_1.png", "private/figures/sub-002/FIGURE_2.png", "private/figures/sub-002/FIGURE_3.png"]);
  // Not what was extracted: refused.
  await ws.writeBytes(figurePath("sub-001", first)!, new Uint8Array([1, 2, 3]));
  await expect(readFigure(ws, "sub-001", first)).rejects.toThrow("isn't the image that was extracted");
  // Imported again from a file with no figures: the old ones go.
  await importCohort(ws, bytesSource("100200301 - QUILL AVERY . - report.docx", packFile("submissions/sub-a.docx")), { replace: true });
  expect((await loadSubmission(ws, "sub-001")).extract!.figures).toEqual([]);
  expect(existsSync(join(path, "private", "figures", "sub-001", "FIGURE_1.png"))).toBe(false);
  expect(readFileSync(join(path, "private", "figures", "sub-002", "FIGURE_3.png")).subarray(0, 8)).toEqual(Buffer.from(PNG_SIGNATURE));
});

test("anonymisation never redacts a figure's placeholder, or into one", () => {
  const key = PseudonymKey.parse({ entries: [] });
  const text = "See [FIGURE_1] and Figure 1 from Fig Ltd.\n\n[FIGURE_12]";
  const rules = AnonymisationRules.parse({ names: ["Figure"], organisations: ["Fig Ltd"], redact: { FIGURE: "ORG", "E_1": "ID" } });
  const [out] = apply(text, detect(text, key, rules), key);
  expect(out).toContain("See [FIGURE_1] and");
  expect(out.endsWith("[FIGURE_12]")).toBe(true);
  expect(out).not.toContain("Figure 1 from Fig Ltd"); // what the rules are for is still redacted
});
