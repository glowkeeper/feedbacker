/**
 * Importing the original marker's marking from marked views. A port of
 * `core/tests/test_marking.py`, with the #41 spike's parser checks.
 *
 * Its command-line tests check the Python command line's output and argument
 * parsing (`--criterion NAME=ID`, numbers given as text). The behaviour
 * behind them (import with an explicit mapping, replace, the review summary,
 * confirm, manual entry) is tested here; parsing arguments stays with the
 * Python command line.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import {
  bytesSource,
  confirmMarking,
  CRITERION,
  describeBetween,
  enterMarking,
  ExtractionError,
  importMarking,
  importRubric,
  listZip,
  loadMarking,
  MarkingProblem,
  markingSummary,
  parseMarkedView,
  readPages,
  recordRequest,
  Rubric,
  RUBRIC_TOTAL,
  WorkspaceError,
  type ByteSource,
  type Workspace,
  unmappedCriteria,
  buildAssessment,
  loadCriteriaMap,
  loadRubric,
} from "../src/core/index.ts";
import { makeZip, packFile, pdfPages, textPdf, type TextLine } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

const REPLICA = packFile("marked-view-replica.pdf");
let ws: Workspace;
let path: string;
beforeEach(async () => {
  ({ ws, path } = await newWorkspace());
  await recordRequest(ws, [{ external_id: "100200302" }]);
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
});

const viewsZip = (report = "Number of files requested: 2\nFailed file count: 0\n", name = "100200302 - PIKE JORDAN - Study_Buddy.docx.pdf") =>
  bytesSource(
    "grademark_1.zip",
    makeZip({ [name]: REPLICA, "100200399 - OTHER STUDENT - x.docx.pdf": "never opened", "download_report.txt": report }),
  );

// --- Parsing the observed layout -----------------------------------------------------------

test("parses the replica", async () => {
  const v = await parseMarkedView(REPLICA);
  expect([v.external_id, v.word_count, v.grade, v.grade_max]).toEqual(["100200302", 1805, 60, 100]);
  expect(v.rubric_total).toBe(59.75);
  expect(v.warnings).toEqual([]);
  expect(v.comments.map((c) => [c.number, c.criterion_label, c.page])).toEqual([
    [1, "Requirements", 1],
    [2, "Testing", 2],
    [3, null, 3],
  ]);
  expect(v.comments.map((c) => c.position)).toEqual([0.301, 0.621, 0.451]);
  expect(v.criteria.map((c) => [c.name, c.weight, c.score, c.selected_label])).toEqual([
    ["REQUIREMENTS", 25, 68, "2:1 (68)"],
    ["IMPLEMENTATION", 25, 58, "2:2 (55)"],
    ["TESTING", 25, 58, "2:2 (58)"],
    ["PROFESSIONALISM", 25, 55, "2:2 (55)"],
  ]);
  // From the spike: the raw forms, the general comment, and every level counted.
  expect([v.raw_grade, v.raw_rubric_total]).toEqual(["60 /100", "59.75 / 100"]);
  expect(v.general_comment).toBe(
    "Strengths: Jordan built a working planner with clear screens. Weaknesses: the timetable bug remains and testing is informal. Contact j.pike@example.com if anything is unclear.",
  );
  expect(v.criteria.every((c) => c.levels === 8)).toBe(true);
});

test("parsing reports what it cannot find", async () => {
  const v = await parseMarkedView(pdfPages(["Just some text."]));
  expect(v.warnings).toEqual([
    "no image-rendered report pages found; is this a marked view?",
    "no Submission ID found in the header",
    "no grade and general comments section found",
    "no rubric section found",
  ]);
});

/** One rubric criterion whose levels are filled with `fill(colour)` operators. */
const rubricPage = (fill: (selected: boolean) => string) =>
  textPdf([
    [
      "0 g BT /F1 10 Tf 60 800 Td (RUBRIC: X-1 58 / 100) Tj ET",
      "0 g BT /F1 10 Tf 60 780 Td (ANALYTICAL \\(100%\\) 58 / 100) Tj ET",
      ...[70, 58, 45].map((points, i) => `${fill(points === 58)} BT /F1 10 Tf 60 ${760 - i * 20} Td (Band ${i} \\(${points}\\) A fictional descriptor.) Tj ET`),
    ],
  ]);

test.each([
  ["rgb", (s: boolean) => (s ? "0 0 0 rg" : "0.6 0.6 0.6 rg")],
  ["grey", (s: boolean) => (s ? "0 g" : "0.6 g")],
  ["cmyk", (s: boolean) => (s ? "0 0 0 1 k" : "0 0 0 0.4 k")],
])("the selected level is found in any colour space (%s)", async (_, fill) => {
  const v = await parseMarkedView(rubricPage(fill));
  expect(v.criteria.map((c) => [c.selected_label, c.selected_points])).toEqual([["Band 1 (58)", 58]]);
  expect(v.warnings.some((w) => w.includes("selected level"))).toBe(false);
});

test("a CMYK near-tie is warned, not guessed", async () => {
  const v = await parseMarkedView(rubricPage((s) => (s ? "0 0 0 0.45 k" : "0 0 0 0.4 k")));
  expect(v.criteria[0].selected_label).toBeNull();
  expect(v.warnings).toContain("criterion 'ANALYTICAL': the selected level could not be identified");
});

// --- Import ------------------------------------------------------------------------------------

test("import maps to the source rubric and notes disagreements", async () => {
  const result = await importMarking(ws, viewsZip());
  expect(result.ignoredCount).toBe(2);
  expect(result.failed.size).toBe(0);
  const a = await loadMarking(ws, "sub-001");
  const marks = Object.fromEntries(a.criterion_marks.map((m) => [m.criterion_id, m]));
  // REQUIREMENTS and TESTING map by unique prefix; IMPLEMENTATION exactly.
  expect(Object.keys(marks).sort()).toEqual(["implementation", "requirements-and-design", "testing-and-evaluation"]);
  expect(marks["requirements-and-design"].level_id).toBe("p68"); // an exact points match
  expect(marks.implementation.level_id).toBeNull(); // 58 is between source levels
  expect([marks.implementation.raw_label, marks.implementation.raw_score, marks.implementation.raw_criterion]).toEqual(["2:2 (55)", "58 / 100", "IMPLEMENTATION"]);
  const notes = a.import_notes.join("\n");
  expect(notes).toContain("selected level 2:2 (55) disagrees with the awarded score 58 / 100");
  expect(notes).toContain("awarded 58 is between");
  expect(notes).toContain("criterion 'PROFESSIONALISM'");
  expect(notes).toContain("could not be mapped");
  expect([a.overall_mark, a.raw_overall, a.raw_rubric_total]).toEqual([60, "60 /100", "59.75 / 100"]); // exactly as written
  expect(a.import_route).toBe("turnitin_bulk_zip");
  expect(a.confirmed_at).toBeNull();
});

test("comments are anonymised with the workspace's tokens", async () => {
  await importMarking(ws, viewsZip());
  const a = await loadMarking(ws, "sub-001");
  expect(a.annotations[0].text).toBe("Good choice of framework, [STUDENT_A].");
  expect(a.overall_comment).not.toContain("Jordan");
  expect(a.overall_comment).not.toContain("j.pike@example.com");
  expect(a.overall_comment).toContain("[STUDENT_A]");
  expect(a.overall_comment).toContain("[EMAIL_1]");
  const raw = readFileSync(join(path, "marking", "sub-001--marker.json"), "utf8");
  for (const value of ["Jordan", "PIKE", "100200302"]) expect(raw).not.toContain(value);
  const entry = (await ws.readKey()).entries[0];
  expect(entry.names).toEqual(["PIKE JORDAN"]);
  expect(entry.source_files.marked).toBe("100200302 - PIKE JORDAN - Study_Buddy.docx.pdf");
});

test("an explicit mapping, and the correction history", async () => {
  await importMarking(ws, viewsZip());
  await importMarking(ws, viewsZip(), { criteria: { PROFESSIONALISM: "reflection-and-professional-practice" }, replace: true });
  const a = await loadMarking(ws, "sub-001");
  expect(a.criterion_marks.map((m) => m.criterion_id)).toContain("reflection-and-professional-practice");
  expect(a.import_notes.some((n) => n.includes("could not be mapped"))).toBe(false);
  expect(readdirSync(join(path, "marking", "history"))).toHaveLength(1);
  await expect(importMarking(ws, viewsZip(), { criteria: { X: "nope" }, replace: true })).rejects.toThrow("unknown source criterion");
});

test("download-report failures and a Submission ID mismatch are reported", async () => {
  expect((await importMarking(ws, viewsZip("Failed file count: 1\n"))).downloadWarnings).toEqual(["source 1: its download report lists 1 failed file(s)"]);
  await recordRequest(ws, [{ external_id: "100200303" }], { replace: true });
  await importMarking(ws, viewsZip(undefined, "100200303 - MARSH RILEY - x.docx.pdf"));
  expect((await loadMarking(ws, "sub-002")).import_notes.some((n) => n.includes("Submission ID inside the marked view differs"))).toBe(true);
});

test("a missing view, and a missing rubric", async () => {
  await expect(importMarking(ws, bytesSource("empty.zip", makeZip({ "100200399 - X - y.pdf": "" })))).rejects.toThrow(/no file found for \[STUDENT_A\]/);
  const { ws: bare } = await newWorkspace("bare");
  await recordRequest(bare, [{ external_id: "100200302" }]);
  await expect(importMarking(bare, viewsZip())).rejects.toThrow("import the source rubric first");
});

test("unmapped names are listed with the source IDs", async () => {
  const result = await importMarking(ws, viewsZip());
  expect([...result.unmapped]).toEqual(["PROFESSIONALISM"]);
  expect(result.sourceIds).toContain("reflection-and-professional-practice");
});

test("the names left unmapped are kept on the record exactly as written, until a mapping imports them", async () => {
  await importMarking(ws, viewsZip());
  expect(unmappedCriteria(await loadMarking(ws, "sub-001"))).toEqual(["PROFESSIONALISM"]);
  // Any name survives, quotes and brackets included; a name already mapped once isn't offered again.
  const view = await parseMarkedView(REPLICA);
  view.criteria[3].name = "USE OF 'AI' (v2)";
  view.criteria.push({ ...view.criteria[0] }); // REQUIREMENTS twice: the second is "already mapped", not unmapped
  const built = buildAssessment(view, {
    submissionId: "sub-001",
    externalId: "100200302",
    rubric: await loadRubric(ws),
    criteriaMap: await loadCriteriaMap(ws),
    key: await ws.readKey(),
    rules: { names: [], organisations: [], redact: {}, ignore: [] },
    route: "turnitin_current_view",
    source: "x",
    inputHashes: [],
    now: new Date("2026-09-29T12:00:00Z"),
  });
  expect(unmappedCriteria(built)).toEqual(["USE OF 'AI' (v2)"]);
  await importMarking(ws, viewsZip(), { criteria: { PROFESSIONALISM: "reflection-and-professional-practice" }, replace: true });
  expect(unmappedCriteria(await loadMarking(ws, "sub-001"))).toEqual([]);
});

test("reimporting requires replace", async () => {
  await importMarking(ws, viewsZip());
  await expect(importMarking(ws, viewsZip())).rejects.toThrow("already imported");
});

// --- Confirmation, manual entry, and review ---------------------------------------------------

test("confirmation, and manual entry with history", async () => {
  await importMarking(ws, viewsZip());
  expect((await confirmMarking(ws, "sub-001")).confirmed_by!.kind).toBe("moderator");
  const manual = await enterMarking(ws, "sub-001", { overall: 61, criteria: { implementation: 55 }, comment: "Jordan's app works." });
  expect(manual.import_route).toBe("manual");
  expect(manual.confirmed_at).not.toBeNull();
  expect(manual.criterion_marks[0].level_id).toBe("p55");
  expect(manual.overall_comment).toBe("[STUDENT_A]'s app works.");
  expect(readdirSync(join(path, "marking", "history"))).toHaveLength(1);
  expect((await enterMarking(ws, "sub-001", { markerLabel: "second marker", overall: 58 })).marker_label).toBe("second marker");
  await expect(enterMarking(ws, "sub-001", { criteria: { nope: 1 } })).rejects.toThrow(new MarkingProblem(["unknown source criterion 'nope'"]));
  await expect(enterMarking(ws, "sub-009", { overall: 1 })).rejects.toThrow("not in the sample");
});

test("describing a score uses the source rubric", async () => {
  const c = Rubric.parse(JSON.parse(readFileSync(join(path, "rubric.json"), "utf8"))).criteria.find((x) => x.id === "implementation")!;
  expect(describeBetween(68, c)).toBe("2:1 (68)");
  expect(describeBetween(58, c)).toBe("between 2:2 (55) and 2:1 (62)");
  expect(describeBetween(10, c)).toBe("below FAIL (20)");
  expect(describeBetween(99, c)).toBe("above 1ST (85)");
});

test("import with a mapping, replace, review, confirm and enter (as the command line does)", async () => {
  const result = await importMarking(ws, viewsZip(), { criteria: { PROFESSIONALISM: "reflection-and-professional-practice" } });
  expect([result.imported.length, result.ignoredCount, result.unmapped.size]).toEqual([1, 2, 0]);
  await importMarking(ws, viewsZip(), { replace: true });
  const shown = (await markingSummary(ws, "sub-001")).join("\n");
  expect(shown).toContain("NOT CONFIRMED");
  expect(shown).toContain("between 2:2 (55) and 2:1 (62)");
  expect(shown).not.toContain("Jordan");
  await confirmMarking(ws, "sub-001");
  expect((await markingSummary(ws, "sub-001"))[0]).toContain("CONFIRMED");
  await enterMarking(ws, "sub-001", { markerLabel: "agreed", overall: 59, criteria: { implementation: 58 } });
  expect((await markingSummary(ws, "sub-001", "agreed"))[0]).toBe("sub-001 (agreed, manual): overall 59.0; CONFIRMED");
});

// --- Review fixes ---------------------------------------------------------------------------------

test("only the download report is read, never students' text files", async () => {
  const bytes = makeZip({
    "100200302 - PIKE JORDAN - Study_Buddy.docx.pdf": REPLICA,
    "100200399 - OTHER STUDENT - essay.txt": "Failed file count: 9 (a student's text)",
    "nested/notes.txt": "Failed file count: 7",
    "download_report.txt": "Failed file count: 0",
  });
  const reads: [number, number][] = [];
  const source: ByteSource = { name: "g.zip", size: bytes.length, read: async (o, n) => (reads.push([o, o + n]), bytes.subarray(o, o + n)) };
  // Opening a member starts with reading its local header, at its recorded offset.
  // (Listing reads the end of the file, and hashing reads all of it as bytes, as
  // Python's read_bytes does; neither opens a member.)
  const entries = await listZip(bytesSource("g.zip", bytes));
  const touched = (name: string) => reads.some(([a]) => a === entries.find((e) => e.name === name)!.localHeaderOffset && a !== 0);
  const result = await importMarking(ws, source);
  expect(result.downloadWarnings).toEqual([]);
  expect(touched("100200399 - OTHER STUDENT - essay.txt")).toBe(false);
  expect(touched("nested/notes.txt")).toBe(false);
  expect(touched("download_report.txt")).toBe(true);
});

test("an incomplete marked view fails instead of importing", async () => {
  const partial = pdfPages(["Submission ID: 100200302\nSome text"]);
  const result = await importMarking(ws, bytesSource("g.zip", makeZip({ "100200302 - PIKE JORDAN - x.pdf": partial })));
  expect(result.imported).toEqual([]);
  expect(result.failed.get("sub-001")!.startsWith("not a complete marked view:")).toBe(true);
  expect(result.failed.get("sub-001")).toContain("the overall grade");
  expect(await ws.exists("marking/sub-001--marker.json")).toBe(false);
});

test("page-level errors become extraction errors", async () => {
  class RuntimeError extends Error {
    name = "RuntimeError";
  }
  await expect(
    parseMarkedView(REPLICA, async () => {
      throw new RuntimeError("damaged content stream");
    }),
  ).rejects.toThrow(new ExtractionError("the marked view could not be read (RuntimeError)"));
});

test("a comment without a marker is warned about", async () => {
  const v = await parseMarkedView(REPLICA, async (pdf) => {
    const [reportPage, , lines] = await readPages(pdf);
    return [reportPage, new Map(), lines];
  });
  expect(v.warnings).toContain("comment 2: its marker was not found on the report pages, so its position is unknown");
  expect(v.comments.every((c) => c.position === null)).toBe(true);
});

test("raw scores keep their written form", () => {
  expect(CRITERION.exec("ANALYTICAL (20%) 58/100")!.groups!.raw).toBe("58/100");
  expect(CRITERION.exec("ANALYTICAL (20%) 58.0 /  100")!.groups!.raw).toBe("58.0 /  100");
  expect(RUBRIC_TOTAL.exec("RUBRIC: X-1 61.55/100")!.groups!.raw).toBe("61.55/100");
});

// --- From the #41 spike, and beyond the Python tests --------------------------------------------

test("unreadable input fails clearly", async () => {
  await expect(parseMarkedView(new TextEncoder().encode("This is not a PDF.\n"))).rejects.toThrow(
    new ExtractionError("the marked view could not be read (InvalidPDFException)"),
  );
});

test("comments without markers or text are warned about", async () => {
  const lines: TextLine[] = [
    { text: "FINAL GRADE GENERAL COMMENTS", x: 32, y: 760 },
    { text: "PAGE 1", x: 32, y: 700 },
    { text: "Comment 1 | Testing", x: 68, y: 684 },
    { text: "Some testing evident.", x: 68, y: 656 },
    { text: "Comment 2", x: 68, y: 620 },
  ];
  const v = await parseMarkedView(textPdf([lines]));
  expect(v.comments.map((c) => [c.number, c.criterion_label, c.text, c.page, c.position])).toEqual([
    [1, "Testing", "Some testing evident.", 1, null],
    [2, null, "", 1, null],
  ]);
  expect(v.warnings).toContain("no overall grade found");
  expect(v.warnings).toContain("comment 2 has no text");
});

test("a level that is only slightly darker is warned about, not guessed", async () => {
  const v = await parseMarkedView(rubricPage((s) => (s ? "0.55 0.55 0.55 rg" : "0.6 0.6 0.6 rg")));
  expect(v.criteria[0].selected_label).toBeNull();
});

test("a rubric total that rounds differently from the grade is noted (Python's round, ties to even)", async () => {
  // 59.5 rounds to 60 in Python (and 60.5 to 60), so only the >= 1 rule can differ here.
  const { pyRoundInt } = await import("../src/core/pytext.ts");
  expect([pyRoundInt(59.5), pyRoundInt(60.5), pyRoundInt(58.5), pyRoundInt(-0.5)]).toEqual([60, 60, 58, -0]);
});

// --- Review of #63 -------------------------------------------------------------------------

test("a level whose colour can't be read is never selected: the criterion is warned about", async () => {
  // Python reads such a line as darkness 0, darker than the dark grey (0.2) of
  // the truly selected level, and would select it.
  const page = rubricPage((s) => (s ? "0.2 g" : "0.6 g"));
  expect((await parseMarkedView(page)).criteria[0].selected_label).toBe("Band 1 (58)");
  const v = await parseMarkedView(page, async (pdf) => {
    const [reportPage, markers, lines] = await readPages(pdf);
    for (const line of lines) if (line.text.startsWith("Band 0")) for (const c of line.chars) c.colour = null;
    return [reportPage, markers, lines];
  });
  expect(v.criteria[0].selected_label).toBeNull();
  expect(v.warnings).toContain("criterion 'ANALYTICAL': the selected level could not be identified");
});

test("a root-level text file that isn't a report is never opened", async () => {
  const bytes = makeZip({
    "100200302 - PIKE JORDAN - Study_Buddy.docx.pdf": REPLICA,
    "essay.txt": "Failed file count: 9 (a student's text)",
    "download_report.txt": "Failed file count: 0",
  });
  const reads: number[] = [];
  const source: ByteSource = { name: "g.zip", size: bytes.length, read: async (o, n) => (reads.push(o), bytes.subarray(o, o + n)) };
  const entries = await listZip(bytesSource("g.zip", bytes));
  const opened = (name: string) => reads.includes(entries.find((e) => e.name === name)!.localHeaderOffset);
  expect((await importMarking(ws, source)).downloadWarnings).toEqual([]);
  expect(opened("essay.txt")).toBe(false);
  expect(opened("download_report.txt")).toBe(true);
});

test("the download report is read from manifest.txt, and only its failed count is kept", async () => {
  // The structure of Turnitin's GradeMark manifest, with fictional names and IDs.
  const manifest = [
    "The requested files for download id 00000000-0000-4000-8000-000000000000 are now available",
    "",
    "Number of files requested: 2",
    "Success file count: 1",
    "Failed file count: 1",
    "",
    "Files",
    "100200302 - PIKE JORDAN - Study_Buddy.docx.pdf - SUCCESS",
    "100200399 - OTHER STUDENT - Essay.docx.pdf - FAILED",
    "",
  ].join("\n");
  const zip = bytesSource("grademark_1.zip", makeZip({ "100200302 - PIKE JORDAN - Study_Buddy.docx.pdf": REPLICA, "manifest.txt": manifest }));
  const result = await importMarking(ws, zip);
  expect(result.downloadWarnings).toEqual(["source 1: its download report lists 1 failed file(s)"]);
  const everything = JSON.stringify({ ...result, failed: [...result.failed], unmapped: [...result.unmapped] }) + readFileSync(join(path, "marking", "sub-001--marker.json"), "utf8");
  for (const listed of ["OTHER STUDENT", "100200399", "Essay.docx"]) expect(everything).not.toContain(listed);
});

test("replacements in the same millisecond keep every earlier record in the history", async () => {
  const now = new Date("2026-09-27T12:00:00.000Z");
  for (const overall of [50, 55, 60]) await enterMarking(ws, "sub-001", { overall, now });
  const history = readdirSync(join(path, "marking", "history")).sort();
  expect(history).toEqual(["sub-001--marker--20260927T120000000000-2.json", "sub-001--marker--20260927T120000000000.json"]);
  const kept = history.map((f) => JSON.parse(readFileSync(join(path, "marking", "history", f), "utf8")).overall_mark).sort();
  expect(kept).toEqual([50, 55]);
});

test("the history is private, and a failed correction leaves none behind", async () => {
  await enterMarking(ws, "sub-001", { overall: 50 });
  await enterMarking(ws, "sub-001", { overall: 55 });
  const [first] = readdirSync(join(path, "marking", "history"));
  expect(statSync(join(path, "marking", "history", first)).mode & 0o777).toBe(0o600);
  const writeText = ws.fs.writeText.bind(ws.fs);
  ws.fs.writeText = async (p: string, t: string) => {
    if (p === "marking/sub-001--marker.json") throw new Error("disk full");
    return writeText(p, t);
  };
  await expect(enterMarking(ws, "sub-001", { overall: 60 })).rejects.toThrow("disk full");
  ws.fs.writeText = writeText;
  expect(readdirSync(join(path, "marking", "history"))).toEqual([first]); // the failed replacement kept no copy
  expect((await loadMarking(ws, "sub-001")).overall_mark).toBe(55);
});

test("if a record can't be written, its previous marked view and record stay together", async () => {
  await importMarking(ws, viewsZip(), { now: new Date("2026-09-27T12:00:00.000Z") });
  const before = await loadMarking(ws, "sub-001");
  const storedBefore = readFileSync(join(path, "sources", "marked", "sub-001.pdf"));
  // A different file (the replica with bytes after its end), so the stored view would change.
  const changed = makeZip({ "100200302 - PIKE JORDAN - Study_Buddy.docx.pdf": new Uint8Array([...REPLICA, ...new TextEncoder().encode("\n% a later copy\n")]) });
  const writeText = ws.fs.writeText.bind(ws.fs);
  ws.fs.writeText = async (p: string, t: string) => {
    if (p === "marking/sub-001--marker.json") throw new Error("disk full");
    return writeText(p, t);
  };
  await expect(importMarking(ws, bytesSource("g.zip", changed), { replace: true, now: new Date("2026-09-27T12:30:00.000Z") })).rejects.toThrow("disk full");
  ws.fs.writeText = writeText;
  expect(await loadMarking(ws, "sub-001")).toEqual(before);
  expect(readFileSync(join(path, "sources", "marked", "sub-001.pdf")).equals(storedBefore)).toBe(true);
  const history = join(path, "marking", "history");
  expect(existsSync(history) ? readdirSync(history) : []).toEqual([]); // no copy of a replacement that didn't happen
  expect(statSync(join(path, "sources", "marked", "sub-001.pdf")).mode & 0o777).toBe(0o600);
});
