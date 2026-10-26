/**
 * Reading a moderation request document. Every document here is synthetic
 * and fictional; two layouts are used so the reader isn't tied to one.
 */

import { expect, test } from "vitest";
import { bandDistributionOf, bandFor, readRequestDocument, RequestDocumentError } from "../src/core/index.ts";
import { docx, para, table } from "./builders.ts";

const NAMES = ["Quill Avery", "Pike Jordan", "Marsh Riley", "Fenn Sasha", "Reed Morgan", "Sloan Casey", "Vale Robin"];
const STAFF = ["Dr Ash Thornfield", "Prof Wren Okafor"];

/** A module's context as two-column label and value rows, as institutions' forms lay it out. */
const context = (extra: string[][] = []) =>
  table([
    ["Date", "01/01/2026"],
    ["Programme of Study", "BSc Fictional Computing"],
    ["Module Title (and code if applicable)", "Computing and Society (CMP0001)"],
    ["Module Convener", STAFF[0]],
    ["Marker (if a team list all)", STAFF[1]],
    ["Total number of students on this module", "7 (1 non-submission)"],
    ["Is this module delivered in multiple classes/groups? If so, how many?", "No"],
    ["Total number of submissions marked in this module: 14", "Please record a breakdown of the marks:"],
    ["", "70+ 3 3"],
    ["", "60-69 2 2"],
    ["", "50-59 1 1"],
    ["", "40-49 0 0"],
    ["", "0-39 0 0"],
    ...extra,
  ]);

const HEADER = ["Student ID", "Name", "Assessment Title/Code (if more than one assessment component per module)", "Initial Mark", "Agreed Mark", "Site (if taught on multiple sites)"];
const blank = ["", "", "", "", "", ""];
const person = (i: number, assessment: string, initial: string, agreed: string) => [`A0000010${i}`, NAMES[i], assessment, initial, agreed, ""];

const cohortTable = (rows: string[][]) => table([HEADER, ...rows]);
const document = (...tables: string[]) => docx({ body: para("Moderation Form") + tables.join(para("Unrelated text.")) });

const FORM = document(
  context(),
  cohortTable([
    person(0, "Report (60%)", "82%", "82"),
    person(1, "Report (60%)", "82%", "82"),
    person(2, "Report (60%)", "75%", "75"),
    person(3, "Report (60%)", "65%", ""),
    person(4, "Report (60%)", "65%", "65"),
    person(5, "Report (60%)", "62%", "62"),
    person(6, "Report (60%)", "NS", ""),
    blank,
    blank,
    person(0, "Case study (40%)", "85%", "85"),
    person(1, "Case study (40%)", "82%", ""),
    person(2, "Case study (40%)", "82%", "82"),
    person(3, "Case study (40%)", "78%", "78"),
    person(4, "Case study (40%)", "65%", "65"),
    person(5, "Case study (40%)", "25%", "15"),
    person(6, "Case study (40%)", "NS", ""),
    blank,
  ]),
);

test("reads the module's context", async () => {
  const f = await readRequestDocument("form.docx", FORM);
  expect(f.programme).toBe("BSc Fictional Computing");
  expect(f.module).toBe("Computing and Society (CMP0001)");
  expect(f.cohort_size).toBe(7);
  expect(f.multiple_groups).toBe(false);
  // Each band gives two counts here (one per assessment?), which can't be told apart, so it says so and fills none in.
  expect(f.flags).toEqual(["a band's count is missing or gives more than one number (one per assessment?), so the band distribution wasn't filled in"]);
});

test("reads the whole cohort, for both assessments, skipping blank rows", async () => {
  const f = await readRequestDocument("form.docx", FORM);
  expect(f.cohort).toHaveLength(14);
  const report = f.cohort.filter((r) => r.title === "Report");
  const study = f.cohort.filter((r) => r.title === "Case study");
  expect([report.length, study.length, report[0].weight, study[0].weight]).toEqual([7, 7, 60, 40]);
  expect(report.map((r) => [r.initial, r.agreed, r.submitted])).toEqual([
    [82, 82, true],
    [82, 82, true],
    [75, 75, true],
    [65, null, true],
    [65, 65, true],
    [62, 62, true],
    [null, null, false], // NS: no submission, never a mark
  ]);
  expect(study.find((r) => r.initial === 25)!.agreed).toBe(15);
  expect(f.cohort[0]).toMatchObject({ student_id: "A00000100", name: "Quill Avery", assessment: "Report (60%)" });
  expect(f.cohort.every((r) => r.flags.length === 0)).toBe(true);
});

test("the band distribution is filled in when each band has one count", async () => {
  const one = await readRequestDocument("form.docx", document(table([["Programme of Study", "BSc"], ["Total number of students on this module", "10"], ["", "70+ 4"], ["", "60-69: 3"], ["", "0-59 3"]]), cohortTable([])));
  expect(bandDistributionOf(one)).toEqual([
    { label: "70+", count: 4 },
    { label: "60-69", count: 3 },
    { label: "0-59", count: 3 },
  ]);
  // Two counts in a band (one per assessment?) can't be told apart: flagged, and not guessed.
  const two = await readRequestDocument("form.docx", FORM);
  expect(two.bands.map((b) => b.label)).toEqual(["70+", "60-69", "50-59", "40-49", "0-39"]);
  expect(bandDistributionOf(two)).toEqual([]);
});

test("a mark falls in a band, with fractions in the band below the next", () => {
  const bands = [
    { label: "70+", from: 70, to: null, count: null },
    { label: "60-69", from: 60, to: 69, count: null },
    { label: "0-59", from: 0, to: 59, count: null },
  ];
  expect([82, 70, 69.5, 60, 59.9, 0].map((m) => bandFor(m, bands))).toEqual(["70+", "70+", "60-69", "60-69", "0-59", "0-59"]);
  expect(bandFor(55, [bands[0]])).toBeNull();
});

test("a second layout: another order, one mark, no assessment column", async () => {
  const doc = document(
    table([
      ["Programme", "BA Fictional Studies"],
      ["Module title", "Fiction 101"],
      ["Total number of students on this module", "3"],
      ["Is this module delivered in multiple classes/groups? If so, how many?", "Yes - 2"],
    ]),
    table([
      ["Mark", "Student name", "Student No."],
      ["68", "Quill Avery", "B123"],
      ["", "", ""],
      ["54.5%", "Pike Jordan", "B124"],
      ["Mark", "Student name", "Student No."], // a header repeated on a new page
      ["49", "Marsh Riley", "B125"],
    ]),
  );
  const f = await readRequestDocument("layout2.docx", doc);
  expect(f.multiple_groups).toBe(true);
  expect(f.module).toBe("Fiction 101");
  expect(f.cohort.map((r) => [r.student_id, r.name, r.initial, r.agreed, r.assessment])).toEqual([
    ["B123", "Quill Avery", 68, null, ""],
    ["B124", "Pike Jordan", 54.5, null, ""],
    ["B125", "Marsh Riley", 49, null, ""],
  ]);
  expect(f.flags).toEqual([]);
});

test("uncertain values are flagged beside their row, not corrected, and never quote the document", async () => {
  const f = await readRequestDocument(
    "form.docx",
    document(
      table([["Module Title", "Fiction 101"], ["Total number of students on this module", "5"], ["Is this module delivered in multiple classes/groups?", "Sometimes"]]),
      cohortTable([
        person(0, "Report (60%)", "82%", "82"),
        ["A 1/2", "Pike Jordan", "Report (60%)", "eighty", "", ""],
        ["A0000102", "", "Report (60%)", "70%", "250", ""],
        person(0, "Report (60%)", "82%", "82"), // the same student again
        ["A0000103", "Fenn Sasha", "Report (60%)", "", "", ""],
      ]),
    ),
  );
  expect(f.cohort.map((r) => r.flags)).toEqual([
    [],
    ["its student ID isn't of a form Feedbacker can record (letters, digits, '.', '_' or '-')", "its initial mark couldn't be read as a mark", "it has no initial mark"],
    ["its agreed mark couldn't be read as a mark", "it has no name"],
    ["it has no initial mark"],
  ]);
  expect(f.multiple_groups).toBeNull();
  expect(f.flags).toEqual([
    "row 5 of the table lists a student already listed for the same assessment; it was left out",
    "whether the module was marked in groups couldn't be told",
    "the table lists 4 students for 'Report (60%)', but the document gives a cohort size of 5",
  ]);
  expect(JSON.stringify(f.flags)).not.toMatch(/Pike|Jordan|A0000102|eighty/);
});

test("staff named in the document are never read", async () => {
  const f = await readRequestDocument("form.docx", FORM);
  const everything = JSON.stringify(f);
  for (const staff of STAFF) expect(everything).not.toContain(staff);
});

test("a document with no cohort table or context says so", async () => {
  const f = await readRequestDocument("form.docx", document(table([["Notes", "Nothing here"]])));
  expect(f.cohort).toEqual([]);
  expect(f.flags).toEqual([
    "no table of students with a student ID column and a mark column was found",
    "no module context (programme, module, cohort size) was found",
  ]);
});

test("only a Word document is read, and a damaged one is reported without quoting it", async () => {
  await expect(readRequestDocument("form.pdf", new Uint8Array())).rejects.toThrow(RequestDocumentError);
  await expect(readRequestDocument("form.xlsx", new Uint8Array())).rejects.toThrow("only a Word (docx) request document can be read");
  await expect(readRequestDocument("form.docx", new TextEncoder().encode("not a zip"))).rejects.toThrow(/couldn't be read \(\w+\); it may be damaged/);
});
