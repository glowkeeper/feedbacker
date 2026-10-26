/**
 * Choosing the part of a brief that applies to this assessment, when the brief describes several. Every document is
 * synthetic and fictional.
 */

import { beforeEach, expect, test } from "vitest";
import {
  anonymiseWorkspace,
  approve,
  approvedBriefText,
  Brief,
  briefSections,
  briefText,
  bytesSource,
  importBrief,
  loadBrief,
  normaliseRanges,
  recordRequest,
  reviewLines,
  updateRules,
  setBriefSelection,
  WorkspaceError,
  type Workspace,
} from "../src/core/index.ts";
import { reviewOf } from "../src/app/anonymisation.ts";
import { rangeBounds } from "../src/app/briefRange.ts";
import { docx, para, pdfPages } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

const BRIEF = docx({
  extraStyles: [["Heading3", "heading 3"]],
  body:
    para("Module brief", "Title") +
    para("Module information", "Heading1") +
    para("Module convener: Dr Ash Thornfield, a.thornfield@example.com.") +
    para("Learning outcomes", "Heading1") +
    para("LO1: Evaluate designs using empirical data.") +
    para("Element 1: Report (60%)", "Heading1") +
    para("Write a report on usability tests of a collaboration tool.") +
    para("Report marking", "Heading2") +
    para("Marks are for the design and the data.") +
    para("Element 2: Case Study (40%)", "Heading1") +
    para("Analyse the Nanosoft case study.") +
    para("Contact for this element: Quill Avery.") +
    para("Case study marking", "Heading2") +
    para("Marks are for the analysis."),
});

let ws: Workspace;
beforeEach(async () => {
  ({ ws } = await newWorkspace());
  await recordRequest(ws, [{ external_id: "100200301" }]);
  await importBrief(ws, bytesSource("brief.docx", BRIEF));
});

const titles = async () => briefSections(await loadBrief(ws)).map((s) => [s.level, s.title]);
const rangeOf = async (title: string) => {
  const s = briefSections(await loadBrief(ws)).find((x) => x.title.startsWith(title))!;
  return { start: s.start, end: s.end };
};

test("a brief's sections come from its headings, each running to the next heading of the same or a higher rank", async () => {
  expect(await titles()).toEqual([
    [0, "Module brief"],
    [1, "Module information"],
    [1, "Learning outcomes"],
    [1, "Element 1: Report (60%)"],
    [2, "Report marking"],
    [1, "Element 2: Case Study (40%)"],
    [2, "Case study marking"],
  ]);
  const brief = await loadBrief(ws);
  const sections = briefSections(brief);
  const text = Array.from(brief.extract.text);
  const textOf = (i: number) => text.slice(sections[i].start, sections[i].end).join("");
  expect(textOf(3)).toContain("Report marking"); // its sub-section is part of it
  expect(textOf(3)).not.toContain("Nanosoft"); // the next element isn't
  expect(textOf(4)).toBe("Report marking\n\nMarks are for the design and the data.");
  expect(sections[3].words).toBeGreaterThan(sections[4].words);
});

test("only the chosen parts are the brief's text, set apart, and the rest is out of it", async () => {
  const brief = await setBriefSelection(ws, [await rangeOf("Learning outcomes"), await rangeOf("Element 1")]);
  const text = briefText(brief);
  expect(text).toBe(
    "Learning outcomes\n\nLO1: Evaluate designs using empirical data.\n\nElement 1: Report (60%)\n\nWrite a report on usability tests of a collaboration tool.\n\nReport marking\n\nMarks are for the design and the data.",
  );
  expect(text).not.toContain("Nanosoft");
  expect(text).not.toContain("Thornfield");
  // Overlapping choices (a section and its own sub-section) are one part, in order.
  expect(normaliseRanges([{ start: 40, end: 60 }, { start: 10, end: 20 }, { start: 50, end: 70 }, { start: 20, end: 25 }, { start: 5, end: 5 }])).toEqual([
    { start: 10, end: 25 },
    { start: 40, end: 70 },
  ]);
});

test("only the chosen parts are anonymised, approved and sent", async () => {
  await setBriefSelection(ws, [await rangeOf("Learning outcomes"), await rangeOf("Element 1")]);
  await anonymiseWorkspace(ws);
  const anonymised = (await loadBrief(ws)).anonymised!.text;
  expect(anonymised).toContain("Write a report on usability tests");
  expect(anonymised).not.toContain("Nanosoft");
  expect(anonymised).not.toContain("a.thornfield"); // never even redacted: it isn't in the brief this assessment uses
  await approve(ws, "brief");
  const [sent] = await approvedBriefText(ws);
  expect(sent).toBe(anonymised);
  expect(sent).not.toContain("Nanosoft");
});

test("a different choice clears the brief's anonymised text and approval; the same choice, or the whole brief again, is handled", async () => {
  await anonymiseWorkspace(ws);
  await approve(ws, "brief");
  expect((await loadBrief(ws)).approval).not.toBeNull();
  // The whole brief, chosen as one range from the start, is the whole brief: nothing changes.
  const all = { start: 0, end: Array.from((await loadBrief(ws)).extract.text).length };
  expect((await setBriefSelection(ws, [all])).approval).not.toBeNull();
  expect((await setBriefSelection(ws, null)).selection).toBeNull();
  // A part of it is different text: its anonymised text and approval go until it is anonymised and approved again.
  const part = [await rangeOf("Element 1")];
  const changed = await setBriefSelection(ws, part);
  expect([changed.selection, changed.anonymised, changed.approval]).toEqual([part, null, null]);
  await anonymiseWorkspace(ws);
  await approve(ws, "brief");
  expect((await setBriefSelection(ws, part)).approval).not.toBeNull(); // the same choice: the approval stands
  const back = await setBriefSelection(ws, null);
  expect([back.selection, back.anonymised, back.approval]).toEqual([null, null, null]);
});

test("a choice must be a real part of the text, and importing the brief again starts from the whole", async () => {
  await expect(setBriefSelection(ws, [])).rejects.toThrow(WorkspaceError);
  const brief = await loadBrief(ws);
  expect(Brief.safeParse({ ...brief, selection: [{ start: 3, end: 3 }] }).success).toBe(false); // empty
  expect(Brief.safeParse({ ...brief, selection: [{ start: 0, end: 99999 }] }).success).toBe(false); // beyond the text
  expect(Brief.safeParse({ ...brief, selection: [{ start: 20, end: 30 }, { start: 10, end: 25 }] }).success).toBe(false); // out of order
  await setBriefSelection(ws, [await rangeOf("Element 1")]);
  expect((await importBrief(ws, bytesSource("brief.docx", BRIEF), { replace: true })).selection).toBeNull();
});

test("a brief with no headings (a pdf) has no sections, and a range of its text can still be chosen", async () => {
  const { ws: ws2 } = await newWorkspace();
  await importBrief(ws2, bytesSource("brief.pdf", pdfPages(["Element 1: Report\nWrite a report.\nElement 2: Case Study\nAnalyse a case."])));
  const brief = await loadBrief(ws2);
  expect(briefSections(brief)).toEqual([]);
  const points = Array.from(brief.extract.text);
  const start = points.join("").indexOf("Element 2");
  const chosen = await setBriefSelection(ws2, [{ start, end: points.length }]);
  expect(briefText(chosen)).toMatch(/^Element 2: Case Study[\s\S]*Analyse a case\.$/);
  expect(briefText(chosen)).not.toContain("Element 1");
});

test("a range past the end of the text is refused, never taken for the whole brief", async () => {
  await setBriefSelection(ws, [await rangeOf("Element 1")]);
  await expect(setBriefSelection(ws, [{ start: 0, end: 99999 }])).rejects.toThrow(); // out of bounds: it reaches the validator
  expect(briefText(await loadBrief(ws))).toContain("Element 1"); // and the choice already made stands
  expect((await loadBrief(ws)).selection).toEqual([await rangeOf("Element 1")]);
});

test("real values are shown against the text that was redacted: the chosen part, not the whole brief", async () => {
  await updateRules(ws, { names: ["Quill Avery"] });
  await setBriefSelection(ws, [await rangeOf("Element 2")]); // a later part: its offsets differ from the whole text's
  await anonymiseWorkspace(ws);
  const lines = await reviewLines(ws, "brief", true);
  expect(lines.filter((l) => l.includes("<-")).map((l) => l.trim().replace(/\s+/g, " "))).toEqual(["[PERSON_1] <- 'Quill Avery' (person)"]);
  const review = await reviewOf(ws, "brief", true);
  expect(review.replacements.map((r) => r.original)).toEqual(["Quill Avery"]);
});

test("the lists for a range start from the range already chosen", () => {
  const blocks = [{ start: 0, end: 10 }, { start: 12, end: 20 }, { start: 22, end: 40 }, { start: 42, end: 50 }];
  expect(rangeBounds(blocks, null)).toEqual({ from: 0, to: 3 });
  expect(rangeBounds(blocks, [{ start: 12, end: 40 }])).toEqual({ from: 1, to: 2 }); // saved and shown again: the same blocks
  expect(rangeBounds(blocks, [{ start: 22, end: 50 }])).toEqual({ from: 2, to: 3 });
  expect(rangeBounds(blocks, [{ start: 0, end: 5 }, { start: 22, end: 30 }])).toEqual({ from: 0, to: 3 }); // not a single range: the whole
  expect(rangeBounds([], null)).toEqual({ from: 0, to: 0 });
});
