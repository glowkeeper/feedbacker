/** A request document that is a PDF: rows and columns recovered from where its text sits. Every name and ID is fictional. */

import { expect, test } from "vitest";
import { readRequestDocument, RequestDocumentError } from "../src/core/index.ts";
import { docx, para, pdfWithImagePages, table, textPdf, type TextLine } from "./builders.ts";

const COLUMNS = [60, 140, 260, 400, 470];
const HEADER = ["Student ID", "Name", "Assessment Title/Code", "Initial Mark", "Agreed Mark"];
const ROWS = [
  ["B00000100", "Quill Avery", "Report (60%)", "82%", "82"],
  ["B00000101", "Pike Jordan", "Report (60%)", "62%", ""],
  ["B00000102", "Marsh Riley", "Report (60%)", "NS", ""],
  ["B00000103", "Fenn Sasha", "Report (60%)", "55%", "50"],
];
const CONTEXT = [
  ["Programme of Study", "BSc Fictional Computing"],
  ["Module Title (and code if applicable)", "Fictional Module 101"],
  ["Module Convener", "Dr Ash Thornfield"],
  ["Total number of students on this module", "4"],
];

/** A row of cells as lines of text at the columns' positions, from the top of an A4 page at `y`. */
const cells = (y: number, values: string[], at = COLUMNS, size = 10): TextLine[] => values.flatMap((text, i) => (text ? [{ text, x: at[i], y, size }] : []));
/** A page's lines, one row every 16 points down from y = 780. */
const rows = (all: string[][], at = COLUMNS, start = 780): TextLine[] => all.flatMap((r, i) => cells(start - i * 16, r, at));
const context = () => rows(CONTEXT, [60, 300], 800);

const WORD = docx({ body: para("Moderation Form") + table(CONTEXT) + table([HEADER, ...ROWS]) });
const WITHOUT_HASH = ({ source_sha256: _, ...rest }: Awaited<ReturnType<typeof readRequestDocument>>) => rest;

test("a PDF gives the same findings as the same document in Word", async () => {
  const pdf = textPdf([[...context(), ...rows([HEADER, ...ROWS], COLUMNS, 700)]]);
  const fromPdf = await readRequestDocument("form.pdf", pdf);
  const fromWord = await readRequestDocument("form.docx", WORD);
  expect(WITHOUT_HASH(fromPdf)).toEqual(WITHOUT_HASH(fromWord));
  expect(fromPdf.cohort.map((r) => [r.student_id, r.initial, r.agreed, r.submitted])).toEqual([
    ["B00000100", 82, 82, true],
    ["B00000101", 62, null, true],
    ["B00000102", null, null, false],
    ["B00000103", 55, 50, true],
  ]);
  expect(fromPdf.programme).toBe("BSc Fictional Computing");
  expect(fromPdf.source_sha256).not.toBe(fromWord.source_sha256); // each is hashed as the file it is
});

test("a table that continues on a new page is read, with the header repeated or not", async () => {
  const repeated = textPdf([[...context(), ...rows([HEADER, ...ROWS.slice(0, 2)], COLUMNS, 700)], rows([HEADER, ...ROWS.slice(2)], COLUMNS, 760)]);
  const carried = textPdf([[...context(), ...rows([HEADER, ...ROWS.slice(0, 2)], COLUMNS, 700)], rows(ROWS.slice(2), COLUMNS, 760)]);
  for (const pdf of [repeated, carried]) {
    const f = await readRequestDocument("form.pdf", pdf);
    expect(f.cohort.map((r) => r.student_id)).toEqual(ROWS.map((r) => r[0]));
    expect(f.flags).toEqual([]);
  }
});

test("a table with other columns on another page, and no header, is left out and said, never guessed", async () => {
  const other = [100, 200, 300, 450, 520]; // the same table laid out differently
  const pdf = textPdf([[...context(), ...rows([HEADER, ...ROWS.slice(0, 2)], COLUMNS, 700)], rows(ROWS.slice(2), other, 760)]);
  const f = await readRequestDocument("form.pdf", pdf);
  expect(f.cohort.map((r) => r.student_id)).toEqual(["B00000100", "B00000101"]);
  expect(f.flags.some((x) => x.includes("couldn't be placed in the table's columns") && x.includes("page 2"))).toBe(true);
  expect(JSON.stringify(f.flags)).not.toMatch(/B0000010|Marsh|Fenn/);
});

test("the same table laid out differently on a page with its own header is read there", async () => {
  const other = [40, 120, 240, 380, 460];
  const pdf = textPdf([[...context(), ...rows([HEADER, ...ROWS.slice(0, 2)], COLUMNS, 700)], rows([HEADER, ...ROWS.slice(2)], other, 760)]);
  const f = await readRequestDocument("form.pdf", pdf);
  expect(f.cohort.map((r) => [r.student_id, r.initial])).toEqual([["B00000100", 82], ["B00000101", 62], ["B00000102", null], ["B00000103", 55]]);
});

test("text that runs across two columns, or wraps onto a line of its own, is left out and said", async () => {
  const long = [...ROWS];
  long[1] = ["B00000101", "Pike Jordan with a very long name that runs on into the next column", "Report (60%)", "62%", ""];
  const across = await readRequestDocument("form.pdf", textPdf([[...context(), ...rows([HEADER, ...long], COLUMNS, 700)]]));
  expect(across.cohort.map((r) => r.student_id)).toEqual(["B00000100", "B00000102", "B00000103"]); // the row it can't place isn't guessed
  expect(across.flags.some((x) => x.includes("couldn't be placed in the table's columns"))).toBe(true);
  // A cell's second line is a line of its own: it is not joined to the row above, and the moderator is told.
  const wrapped = [...rows([HEADER, ...ROWS.slice(0, 2)], COLUMNS, 700), ...cells(652, ["", "", "(second line)"])];
  const f = await readRequestDocument("form.pdf", textPdf([[...context(), ...wrapped]]));
  expect(f.cohort.map((r) => r.student_id)).toEqual(["B00000100", "B00000101"]);
  expect(f.cohort[1].assessment).toBe("Report (60%)");
  expect(f.flags.some((x) => x.includes("sit alone in one column"))).toBe(true);
});

test("a running footer at a page's edge is not taken for a stray line", async () => {
  const f = await readRequestDocument("form.pdf", textPdf([[...context(), ...rows([HEADER, ...ROWS], COLUMNS, 700), { text: "Page 1 of 1", x: 270, y: 30, size: 9 }]]));
  expect(f.flags).toEqual([]);
});

test("staff named in a PDF are never read", async () => {
  const f = await readRequestDocument("form.pdf", textPdf([[...context(), ...rows([HEADER, ...ROWS], COLUMNS, 700)]]));
  expect(JSON.stringify(f)).not.toContain("Thornfield");
});

test("a PDF with no table of students says so, and gives what context it can", async () => {
  const f = await readRequestDocument("form.pdf", textPdf([[...context()]]));
  expect(f.cohort).toEqual([]);
  expect(f.flags).toContain("no table of students with a student ID column and a mark column was found");
  expect(f.module).toBe("Fictional Module 101");
});

test("a PDF of pictures of pages is refused, suggesting the Word version", async () => {
  await expect(readRequestDocument("scan.pdf", pdfWithImagePages(0, 2))).rejects.toThrow(RequestDocumentError);
  await expect(readRequestDocument("scan.pdf", pdfWithImagePages(0, 2))).rejects.toThrow(/no OCR; choose the Word \(docx\) version/);
});

test("a damaged PDF is reported without quoting it", async () => {
  await expect(readRequestDocument("form.pdf", new TextEncoder().encode("not a pdf"))).rejects.toThrow(/couldn't be read \(\w+\); it may be damaged/);
  await expect(readRequestDocument("form.txt", new Uint8Array())).rejects.toThrow("only a Word (docx) or PDF request document can be read");
});

// A header whose cells are tall, with their text centred, so its pieces sit at different heights (as a Word table saved as a PDF can have).
const SPREAD = (top: number): TextLine[] => [
  { text: "Name", x: 171, y: top + 14, size: 10 },
  { text: "Assessment Title/Code", x: 269, y: top + 14, size: 10 },
  { text: "Initial", x: 428, y: top + 8, size: 10 },
  { text: "Agreed", x: 470, y: top + 8, size: 10 },
  { text: "Student ID", x: 85, y: top, size: 10 },
  { text: "(as per the assessment)", x: 253, y: top, size: 10 },
  { text: "Mark", x: 429, y: top, size: 10 },
  { text: "Mark", x: 475, y: top, size: 10 },
];
const DATA_AT = [84, 155, 294, 431, 481];

test("a header spread over several lines is joined by its columns, and the table ends where the rows do", async () => {
  const afterTable = [
    ...cells(300, ["Total number of assessments", "", "", "2"], [60, 140, 260, 309]), // the form again, further down
    { text: "70+:", x: 83, y: 280, size: 10 },
    { text: "Some paragraph of guidance that runs well across the page and is not a row of the table of students at all.", x: 60, y: 260, size: 10 },
  ];
  const f = await readRequestDocument("form.pdf", textPdf([[...context(), ...SPREAD(700), ...rows(ROWS, DATA_AT, 660), ...afterTable]]));
  expect(f.cohort.map((r) => [r.student_id, r.initial, r.agreed, r.submitted])).toEqual([
    ["B00000100", 82, 82, true],
    ["B00000101", 62, null, true],
    ["B00000102", null, null, false],
    ["B00000103", 55, 50, true],
  ]);
  expect(f.cohort[0].assessment).toBe("Report (60%)");
  expect(f.flags).toEqual([]);
});

test("a table that runs on to the next page after its header, and then ends, is read; a continuation of a cell is said", async () => {
  const wrapped = [...rows(ROWS.slice(0, 2), DATA_AT, 660), ...cells(634, ["", "Second line"], DATA_AT)]; // a name's second line, close below its row
  const f = await readRequestDocument("form.pdf", textPdf([[...context(), ...SPREAD(700), ...wrapped], [...rows(ROWS.slice(2), DATA_AT, 760), { text: "Page 2 of 2", x: 270, y: 20, size: 9 }]]));
  expect(f.cohort.map((r) => r.student_id)).toEqual(ROWS.map((r) => r[0]));
  expect(f.flags).toEqual(["1 line(s) in the table of students sit alone in one column (text that wrapped from the cell above), so they were left out and not joined to a row"]);
});
