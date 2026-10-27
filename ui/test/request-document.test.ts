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
    ["its student ID isn't of a form Feedbacker can record (letters, digits, '.', '_' or '-'), so it can't be ticked", "its initial mark couldn't be read as a mark", "it has no initial mark"],
    ["its agreed mark couldn't be read as a mark", "it has no name"],
    ["it has no initial mark"],
  ]);
  expect(f.multiple_groups).toBeNull();
  expect(f.flags).toEqual([
    "row 5 of the table lists a student already listed for the same assessment; it was left out",
    "whether the module was marked in groups couldn't be told",
    "the table lists 4 students, but the document gives a cohort size of 5",
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

test("only a Word or PDF document is read, and a damaged one is reported without quoting it", async () => {
  await expect(readRequestDocument("form.pdf", new Uint8Array())).rejects.toThrow(RequestDocumentError);
  await expect(readRequestDocument("form.xlsx", new Uint8Array())).rejects.toThrow("only a Word (docx) or PDF request document can be read");
  await expect(readRequestDocument("form.docx", new TextEncoder().encode("not a zip"))).rejects.toThrow(/couldn't be read \(\w+\); it may be damaged/);
});

test("a programme leader's row is never taken for the programme", async () => {
  const f = await readRequestDocument(
    "form.docx",
    document(table([["Programme Leader", STAFF[0]], ["Programme of Study", "BSc Fictional Computing"], ["Module Leader", STAFF[1]], ["Module Title", "Fiction 101"], ["Total number of students on this module", "3"]]), cohortTable([])),
  );
  expect([f.programme, f.module]).toEqual(["BSc Fictional Computing", "Fiction 101"]);
  for (const staff of STAFF) expect(JSON.stringify(f)).not.toContain(staff);
});

test("a row that gives more than one value isn't read, so a second field is never taken for part of the first", async () => {
  const f = await readRequestDocument(
    "form.docx",
    document(table([["Module Title", "Fiction 101", "Module Convener", STAFF[0]], ["Programme of Study", "BSc Fictional Computing"], ["Total number of students on this module", "3"]]), cohortTable([])),
  );
  expect(f.module).toBeNull();
  expect(f.programme).toBe("BSc Fictional Computing");
  expect(f.flags).toContain("the module row gives more than one value, so it wasn't read");
  expect(JSON.stringify(f)).not.toContain(STAFF[0]);
  // The same value repeated (as a merged cell repeats it) is one value.
  const merged = await readRequestDocument("form.docx", document(table([["Module Title", "Fiction 101", "Fiction 101"], ["Total number of students on this module", "3"]]), cohortTable([])));
  expect(merged.module).toBe("Fiction 101");
});

test("a row with a name or marks but no ID is flagged, and a blank row is not", async () => {
  const f = await readRequestDocument("form.docx", document(cohortTable([person(0, "Report (60%)", "70%", ""), ["", "Pike Jordan", "Report (60%)", "55%", "", ""], ["", "", "Report (60%)", "", "", ""], blank])));
  expect(f.cohort).toHaveLength(1);
  expect(f.flags).toEqual(["row 3 of a table has a name or marks but no student ID, so it was left out", "no module context (programme, module, cohort size) was found"]);
  expect(JSON.stringify(f.flags)).not.toContain("Pike");
});

test("bands: separate cells keep separate counts, a band can be in the label column, and conflicting counts are not settled by choosing", async () => {
  const bandsOf = async (...rows: string[][]) => {
    const f = await readRequestDocument("form.docx", document(table([["Total number of students on this module", "10"], ...rows]), cohortTable([])));
    return { counts: f.bands.map((b) => [b.label, b.count]), distribution: bandDistributionOf(f), flags: f.flags.filter((flag) => flag.includes("band")) };
  };
  // Two equal counts in separate cells are two counts, not one.
  const two = await bandsOf(["", "70+", "3", "3"]);
  expect(two.counts).toEqual([["70+", null]]);
  expect(two.distribution).toEqual([]);
  expect(two.flags).toEqual(["a band's count is missing or gives more than one number (one per assessment?), so the band distribution wasn't filled in"]);
  // The band in the label column, its count beside it.
  const label = await bandsOf(["70+", "4"], ["60-69", "6"]);
  expect(label.distribution).toEqual([{ label: "70+", count: 4 }, { label: "60-69", count: 6 }]);
  expect(label.flags).toEqual([]);
  // The same band with different counts isn't settled by taking the first.
  const conflict = await bandsOf(["", "70+ 3"], ["", "70+ 4"], ["", "60-69 6"]);
  expect(conflict.counts).toEqual([["70+", null], ["60-69", 6]]);
  expect(conflict.distribution).toEqual([]);
  expect(conflict.flags).toEqual(["a band is given with different counts, so the band distribution wasn't filled in"]);
});

test("a student listed twice for one assessment is caught across tables, and the same student in two assessments is not", async () => {
  const f = await readRequestDocument(
    "form.docx",
    document(
      cohortTable([person(0, "Report (60%)", "70%", ""), person(1, "Report (60%)", "60%", "")]),
      cohortTable([person(0, "Report (60%)", "71%", ""), person(0, "Case study (40%)", "72%", "")]),
    ),
  );
  expect(f.cohort.map((r) => [r.student_id, r.assessment])).toEqual([
    ["A00000100", "Report (60%)"],
    ["A00000101", "Report (60%)"],
    ["A00000100", "Case study (40%)"],
  ]);
  expect(f.flags).toContain("row 2 of the table lists a student already listed for the same assessment; it was left out");
});

test("flags refer to an assessment by its order, never by its text, which could hold anything", async () => {
  const f = await readRequestDocument(
    "form.docx",
    document(table([["Total number of students on this module", "5"]]), cohortTable([["A00000100", "Quill Avery", "Pike Jordan A00000107", "70%", "", ""], person(1, "Report (60%)", "60%", "")])),
  );
  expect(f.flags).toContain("the table lists 1 students for assessment 1, but the document gives a cohort size of 5");
  expect(f.flags).toContain("the table lists 1 students for assessment 2, but the document gives a cohort size of 5");
  expect(JSON.stringify(f.flags)).not.toMatch(/Pike|Jordan|A00000107/);
});
