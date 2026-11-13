/**
 * Rubric import from CSV, JSON and grids, keeping labels exactly as written.
 * A port of `core/tests/test_rubric_import.py`.
 *
 * Its command-line tests check the Python command line's output and exit
 * codes. The behaviour behind them (the replace guard, previewing a grid
 * with weights before confirming, a corrupt file failing cleanly) is tested
 * here; parsing `--weight name=value` stays with the Python command line.
 */

import { strToU8 } from "fflate";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import {
  bytesSource,
  importRubric,
  Rubric,
  RUBRIC,
  RUBRIC_WARNINGS,
  RubricError,
  shapeOf,
  suffixAndStem,
  type ImportRubricOptions,
  type Workspace,
} from "../src/core/index.ts";
import { docx, docxWithTable, packFile, table, xlsx, type XlsxCell } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

let ws: Workspace;
let path: string;
beforeEach(async () => {
  ({ ws, path } = await newWorkspace());
});

const file = (name: string, content: string | Uint8Array) => bytesSource(name, typeof content === "string" ? strToU8(content) : content);
const pack = (name: string) => bytesSource(name, packFile(name));
const importFile = (name: string, content: string | Uint8Array, options?: ImportRubricOptions) => importRubric(ws, file(name, content), options);
const problemsOf = async (run: Promise<unknown>): Promise<string> => {
  const err = await run.catch((e) => e);
  expect(err).toBeInstanceOf(RubricError);
  return (err as RubricError).problems.join("\n");
};

test("csv import matches a points-based rubric", async () => {
  const { rubric, warnings } = await importRubric(ws, pack("rubric.csv"), { title: "Synthetic rubric" });
  expect(rubric.criteria.map((c) => c.id)).toEqual([
    "requirements-and-design",
    "implementation",
    "testing-and-evaluation",
    "reflection-and-professional-practice",
  ]);
  const testing = rubric.criteria[2];
  expect([testing.weight, testing.max_points, testing.levels.length]).toEqual([25, 100, 9]);
  const level68 = testing.levels.find((l) => l.points === 68)!;
  expect(level68.label).toBe("2:2 (68)"); // an inconsistent label, kept exactly
  expect(level68.id).toBe("p68");
  expect(rubric.criteria[0].description).toBe("• requirements\n• design justification");
  expect(warnings).toEqual(["criterion 1 ('Requirements and design'): literal '\\n' sequences converted to line breaks"]);
  expect(Rubric.parse(await ws.readJson(RUBRIC))).toEqual(rubric);
  expect(await ws.readJson(RUBRIC_WARNINGS)).toEqual(warnings);
});

test("json import", async () => {
  const json = {
    title: "Fictional",
    criteria: [
      {
        title: "Analysis",
        weight: 50,
        levels: [
          { label: "1ST (85)", points: 85, descriptor: "Excellent." },
          { label: "FAIL (20)", points: 20, descriptor: "Weak." },
        ],
      },
    ],
  };
  const { rubric, warnings } = await importFile("r.json", JSON.stringify(json));
  expect(rubric.title).toBe("Fictional");
  expect(warnings).toEqual([]);
  expect(rubric.criteria[0].levels.map((l) => l.id)).toEqual(["p85", "p20"]);
});

test("all problems are reported together", async () => {
  const csv = "criterion,level_label,points,descriptor\nAnalysis,1ST (85),eighty,Excellent.\nAnalysis,,40,Weak.\nDesign,2:1 (65),65,\n";
  const joined = await problemsOf(importFile("r.csv", csv));
  expect(joined).toContain("'eighty' is not a number");
  expect(joined).toContain("label is empty");
  expect(joined).toContain("descriptor is empty");
  expect(await ws.exists(RUBRIC)).toBe(false);
});

test("missing columns and unsupported types", async () => {
  await expect(importFile("r.csv", "criterion,points\nA,1\n")).rejects.toThrow("missing column");
  await expect(importFile("r.odt", "")).rejects.toThrow("use .csv, .json, .xlsx, or .docx");
});

test("reimporting requires replace", async () => {
  const { rubric } = await importRubric(ws, pack("rubric.csv"));
  expect(rubric.criteria).toHaveLength(4); // what the command line reports as "4 criteria"
  await expect(importRubric(ws, pack("rubric.csv"))).rejects.toThrow("already imported");
  await importRubric(ws, pack("rubric.csv"), { replace: true });
});

// --- Grid rubrics (xlsx and docx tables) ------------------------------------------------

test.each(["rubric-grid.xlsx", "rubric-grid.docx"])("a grid import (%s) is previewed until confirmed", async (name) => {
  const { rubric, warnings, written } = await importRubric(ws, pack(name), { title: "Grid" });
  expect(written).toBe(false);
  expect(await ws.exists(RUBRIC)).toBe(false);
  expect(rubric.criteria).toHaveLength(4);
  expect(warnings).toEqual([]);
  const first = rubric.criteria[0];
  expect(first.title).toBe("Requirements and design");
  expect(first.description.startsWith("• Identifies requirements")).toBe(true);
  expect(first.levels.map((l) => l.label).slice(0, 2)).toEqual(["Exceptional (100)", "Excellent (85)"]);
  expect(first.levels.map((l) => l.points)).toEqual([100, 85, 75, 65, 55, 45, 35, 15, 0]);
  expect(first.levels.at(-1)!.id).toBe("p0");
  const confirmed = await importRubric(ws, pack(name), { title: "Grid", confirm: true });
  expect(confirmed.written).toBe(true);
  expect(Rubric.parse(await ws.readJson(RUBRIC))).toEqual(confirmed.rubric);
});

test("grid weights are applied, and unknown ones rejected", async () => {
  const { rubric } = await importRubric(ws, pack("rubric-grid.xlsx"), { weights: { implementation: 25, "requirements-and-design": 25 } });
  expect(rubric.criteria.slice(0, 2).map((c) => c.weight)).toEqual([25, 25]);
  await expect(importRubric(ws, pack("rubric-grid.xlsx"), { weights: { nope: 10 } })).rejects.toThrow(
    "weight given for unknown criterion 'nope'",
  );
});

test("grid header problems are listed", async () => {
  const grid = xlsx([
    ["", "Excellent (85)", "Good", "Weak (35)"],
    ["Analysis", "Great.", "Fine.", ""],
  ]);
  const joined = await problemsOf(importFile("bad.xlsx", grid));
  expect(joined).toContain("column 3 header (shape 'Aa') does not read 'Label (points)'");
  expect(joined).toContain("descriptor is empty");
});

test("a docx without a grid table explains itself", async () => {
  await expect(importFile("t.docx", docxWithTable())).rejects.toThrow("no rubric grid table found");
});

test("a grid with weights is previewed, then written when confirmed (as the command line does)", async () => {
  const preview = await importRubric(ws, pack("rubric-grid.xlsx"), { weights: { implementation: 25 } });
  expect(preview.written).toBe(false);
  expect(preview.rubric.criteria.find((c) => c.id === "implementation")!.weight).toBe(25);
  expect(await ws.exists(RUBRIC)).toBe(false);
  expect((await importRubric(ws, pack("rubric-grid.xlsx"), { confirm: true })).written).toBe(true);
  expect(await ws.exists(RUBRIC)).toBe(true);
});

// --- Review fixes: exact labels, corrupt docx, zero weights, JSON shape -------------------

test("grid labels are kept exactly as written", async () => {
  const { rubric } = await importFile("g.xlsx", xlsx([["", "Very  good\n(75)", "Weak (35)"], ["Analysis", "Strong.", "Thin."]]));
  expect(rubric.criteria[0].levels[0].label).toBe("Very  good\n(75)");
  expect(rubric.criteria[0].levels[0].points).toBe(75);
});

test("a corrupt docx rubric fails cleanly", async () => {
  await expect(importFile("r.docx", "not a docx")).rejects.toThrow("docx could not be read");
});

test("a zero weight override is validated, not ignored", async () => {
  await expect(importRubric(ws, pack("rubric.csv"), { weights: { implementation: 0 } })).rejects.toThrow("greater than 0");
});

test.each([
  ["[]", "must be an object"],
  ['{"criteria": "x"}', "'criteria' list"],
  ['{"criteria": [1]}', "criterion 1 must be an object"],
  ['{"criteria": [{"title": "A", "levels": {}}]}', "'levels' list of objects"],
])("malformed JSON %s fails cleanly", async (payload, message) => {
  await expect(importFile("r.json", payload)).rejects.toThrow(message);
});

// --- Beyond the Python tests ------------------------------------------------------------

const grid = (rows: XlsxCell[][], options?: Parameters<typeof xlsx>[1]) => importFile("g.xlsx", xlsx(rows, options));

test("a date in a grid is refused, not written out as a date", async () => {
  // Excel turns text such as "1/2" into a date; openpyxl would read it as one.
  const withDate = grid([["", "Good (60)"], ["Analysis", 46024]], { numFmts: { 164: "d/m/yyyy" }, cellXfs: [0, 164] });
  const style1 = xlsx([["", "Good (60)"], ["Analysis", { xml: '<c r="{ref}" s="1"><v>46024</v></c>' }]], { numFmts: { 164: "d/m/yyyy" }, cellXfs: [0, 164] });
  await expect(withDate).resolves.toBeTruthy(); // style 0 is General: a number, read as "46024"
  expect(await problemsOf(importFile("g.xlsx", style1))).toContain("cell B2 holds a date or time");
});

test("a date outside the sheet's recorded size is never read, as in openpyxl", async () => {
  const rows: XlsxCell[][] = [["", "Good (60)"], ["Analysis", "Clear.", { xml: '<c r="{ref}" t="d"><v>2026-01-02</v></c>' }]];
  const { rubric } = await grid(rows, { dimension: "A1:B2" });
  expect(rubric.criteria[0].levels.map((l) => l.descriptor)).toEqual(["Clear."]);
});

test("numbers and booleans in a grid read as Python writes them", async () => {
  const { rubric } = await grid([["", "Good (60)", "Fair (40)", "Weak (20)"], ["Analysis", 7, 7.5, true]]);
  expect(rubric.criteria[0].levels.map((l) => l.descriptor)).toEqual(["7", "7.5", "True"]);
});

test("a named sheet is read, and a missing one is named", async () => {
  const book = xlsx({ Notes: [["nothing here"]], Rubric: [["", "Good (60)"], ["Analysis", "Clear."]] });
  expect((await importFile("g.xlsx", book, { sheet: "Rubric" })).rubric.criteria).toHaveLength(1);
  await expect(importFile("g.xlsx", book, { sheet: "Other" })).rejects.toThrow("xlsx has no sheet 'Other'");
  await expect(importFile("g.xlsx", book)).rejects.toThrow("expected a grid"); // the first sheet, as in Python
});

test("text that isn't UTF-8, and a malformed CSV, fail with a clear problem", async () => {
  await expect(importFile("r.csv", new Uint8Array([0x63, 0xff, 0x0a]))).rejects.toThrow("CSV could not be read: it is not UTF-8 text");
  await expect(importFile("r.csv", "criterion,level_label,points,descriptor\nA,B (1),1,x\ry\n")).rejects.toThrow(
    "CSV could not be read: new-line character seen in unquoted field",
  );
});

test("negative points are listed as a problem", async () => {
  const csv = "criterion,level_label,points,descriptor\nAnalysis,Odd (-5),-5,Strange.\n";
  expect(await problemsOf(importFile("r.csv", csv))).toContain("level 1: Input should be greater than or equal to 0");
});

test("JSON numbers read as Python's json module reads them", async () => {
  const json = '{"criteria": [{"title": 1.0, "levels": [{"label": 85.0, "points": "85%", "descriptor": 12345678901234567890}]}]}';
  const { rubric } = await importFile("n.json", json);
  expect(rubric.criteria[0].title).toBe("1.0");
  expect(rubric.criteria[0].levels[0]).toMatchObject({ label: "85.0", points: 85, descriptor: "12345678901234567890" });
});

test("file names split into stem and suffix as Python 3.14 splits them", () => {
  expect(suffixAndStem("r.csv")).toEqual([".csv", "r"]);
  expect(suffixAndStem("r.")).toEqual([".", "r"]);
  expect(suffixAndStem(".csv")).toEqual(["", ".csv"]);
  expect(suffixAndStem("a.b.CSV")).toEqual([".CSV", "a.b"]);
  expect(suffixAndStem("..csv")).toEqual(["", "..csv"]);
});

test("JSON objects keep their written order, as Python's json module keeps it", async () => {
  const json = '{"criteria": [{"title": "A", "levels": [{"label": "L", "points": 1, "descriptor": {"2": "b", "1": "a", "2": "c"}}]}]}';
  const { rubric } = await importFile("o.json", json);
  expect(rubric.criteria[0].levels[0].descriptor).toBe("{'2': 'c', '1': 'a'}"); // the last "2" wins, in the first one's place
});

test("NaN weights and maximums are listed as problems", async () => {
  const csv = "criterion,level_label,points,descriptor,weight,max_points\nA,L,1,D,nan,nan\n";
  const problems = await problemsOf(importFile("n.csv", csv));
  expect(problems).toBe("criterion 1 ('A'): Input should be greater than 0\ncriterion 1 ('A'): Input should be greater than 0");
});

/** Make writing one workspace file fail, as a full disk or a revoked permission would. */
function failWrite(name: string) {
  const writeText = ws.fs.writeText.bind(ws.fs);
  ws.fs.writeText = async (p: string, text: string) => {
    if (p === name) throw new Error("disk full");
    return writeText(p, text);
  };
}

test("if the rubric can't be written, the previous warnings are put back", async () => {
  await importRubric(ws, pack("rubric.csv")); // one warning
  const before = readFileSync(join(path, RUBRIC_WARNINGS), "utf8");
  const rubricBefore = readFileSync(join(path, RUBRIC), "utf8");
  failWrite(RUBRIC);
  await expect(importRubric(ws, pack("rubric.json"), { replace: true })).rejects.toThrow("disk full"); // no warnings
  expect(readFileSync(join(path, RUBRIC_WARNINGS), "utf8")).toBe(before);
  expect(readFileSync(join(path, RUBRIC), "utf8")).toBe(rubricBefore);
});

test("if the first rubric can't be written, no warnings are left behind", async () => {
  failWrite(RUBRIC);
  await expect(importRubric(ws, pack("rubric.csv"))).rejects.toThrow("disk full");
  expect(await ws.exists(RUBRIC_WARNINGS)).toBe(false);
  expect(await ws.exists(RUBRIC)).toBe(false);
});

// --- Named layouts for the level headers (fictional rubrics) -------------------------------

/** A level header lists its marks with the band after it; the same band appears in more than one column; the last level is just 0; weights are in the names. */
const UK_STYLE = [
  ["Criteria", "98, 95, 92 (1st)", "88, 85, 82 (1st)", "78, 75, 72 (1st)", "68,65/62 (2:1)", "38, 35 (fail)", "28, 25, 22 (fail)", "0"],
  ["Research question (25%)", "Outstanding.", "Excellent.", "Very good.", "Good.", "Weak.", "Poor.", "Nothing."],
  ["Method (25.5 %)", "a1", "a2", "a3", "a4", "a5", "a6", "a7"],
  ["Analysis (  30%  )", "b1", "b2", "b3", "b4", "b5", "b6", "b7"],
  ["Presentation (20%) notes", "c1", "c2", "c3", "c4", "c5", "c6", "c7"],
];

test("a level header of marks and a band is read: the middle mark stands for the level, the header is its label, and the preview says so", async () => {
  const { rubric, warnings, written } = await importFile("uk.xlsx", xlsx(UK_STYLE));
  expect(written).toBe(false); // previewed, as any grid is
  const levels = rubric.criteria[0].levels;
  expect(levels.map((l) => l.label)).toEqual(UK_STYLE[0].slice(1)); // as written
  expect(levels.map((l) => l.points)).toEqual([95, 85, 75, 65, 36.5, 25, 0]); // the middle of three; between the two of a pair; a single mark
  expect(levels.map((l) => l.id)).toEqual(["p95", "p85", "p75", "p65", "p36-5", "p25", "p0"]);
  expect(warnings).toEqual([
    "xlsx: read with the layout 'marks, then an optional band in brackets': a level with several marks is worth the middle one",
    "xlsx: column 2 '98, 95, 92 (1st)' is worth 95, the middle of its marks 98, 95, 92",
    "xlsx: column 3 '88, 85, 82 (1st)' is worth 85, the middle of its marks 88, 85, 82",
    "xlsx: column 4 '78, 75, 72 (1st)' is worth 75, the middle of its marks 78, 75, 72",
    "xlsx: column 5 '68,65/62 (2:1)' is worth 65, the middle of its marks 68, 65, 62",
    "xlsx: column 6 '38, 35 (fail)' is worth 36.5, the middle of its marks 38, 35",
    "xlsx: column 7 '28, 25, 22 (fail)' is worth 25, the middle of its marks 28, 25, 22",
    "xlsx: column 8 '0' is worth 0",
    "xlsx: row 2 'Research question' is weighted 25, read from '(25%)' in its name",
    "xlsx: row 3 'Method' is weighted 25.5, read from '(25.5%)' in its name",
    "xlsx: row 4 'Analysis' is weighted 30, read from '(30%)' in its name",
  ]);
  // A weight is read only at the end of the name; the others have none, and the name keeps what it says.
  expect(rubric.criteria.map((c) => [c.title, c.weight])).toEqual([["Research question", 25], ["Method", 25.5], ["Analysis", 30], ["Presentation (20%) notes", null]]);
});

test("a weight entered by hand still wins over one in a criterion's name", async () => {
  const { rubric } = await importFile("uk.xlsx", xlsx(UK_STYLE), { weights: { "research-question": 40 } });
  expect(rubric.criteria[0].weight).toBe(40);
});

test("the same layout is read from a docx table, and is chosen over a table that is not a rubric", async () => {
  const rows = UK_STYLE.map((r) => r.map((c) => c));
  const { rubric, warnings } = await importFile("uk.docx", docx({ body: table([["Name", "Value"], ["Latency", "120 ms"]]) + table(rows) }));
  expect(rubric.criteria[0].levels.map((l) => l.points)).toEqual([95, 85, 75, 65, 36.5, 25, 0]);
  expect(warnings[0]).toMatch(/^docx table: read with the layout/);
});

test("the plain 'Label (points)' layout is read as it was, with nothing to say about it", async () => {
  const { rubric, warnings } = await importFile("plain.xlsx", xlsx([["", "Excellent (85)", "Good (65)"], ["Analysis (30%)", "Great.", "Fine."]]));
  expect(rubric.criteria[0].levels.map((l) => [l.label, l.points])).toEqual([["Excellent (85)", 85], ["Good (65)", 65]]);
  expect(warnings).toEqual(["xlsx: row 2 'Analysis' is weighted 30, read from '(30%)' in its name"]); // a weight in a name is read in any layout
});

test("a table whose headers follow two layouts, or none, is not read, and says what it saw", async () => {
  const mixed = await problemsOf(importFile("mixed.xlsx", xlsx([["", "Good (60)", "78, 75, 72 (1st)", "Odd 1st"], ["Analysis", "a", "b", "c"]])));
  expect(mixed).toContain("column 3 header (shape '9, 9, 9 (9a)') does not read 'Label (points)'");
  expect(mixed).toContain("column 4 header (shape 'Aa 9a') does not read 'Label (points)'");
  expect(mixed).not.toContain("Odd"); // what a header says is not repeated (the layouts' own examples are)
  expect(mixed).toContain("a table is read when every level header follows one layout: 'Label (points)', for example 'Excellent (85)'; or marks, then an optional band in brackets, for example '78, 75, 72 (1st)' or '0'");
  expect(mixed).toContain("The level headers here, by shape: 'Aa (9)', '9, 9, 9 (9a)', 'Aa 9a'");
  const none = await problemsOf(importFile("none.xlsx", xlsx([["", "1st: 70+", "70-100"], ["Analysis", "a", "b"]])));
  expect(none).toContain("column 2 header (shape '9a: 9+') does not read 'Label (points)'");
  expect(none).toContain("by shape: '9a: 9+', '9-9'");
});

test("a docx with no readable table says how many tables it has, their sizes and the shapes of their headers", async () => {
  const noTables = await problemsOf(importFile("none.docx", docx({ body: "" })));
  expect(noTables).toContain("no rubric grid table found");
  expect(noTables).toContain("the document has no tables");
  const some = await problemsOf(importFile("some.docx", docx({ body: table([["Name", "Value"], ["Latency", "120 ms"]]) + table([["Weighting", "1st: 70+", "2:1 (60-69)"], ["a", "b", "c"]]) })));
  expect(some).toContain("the document has 2 tables: table 1 is 2 rows by 2 columns, its level headers (after the first column), by shape: 'Aa'; table 2 is 2 rows by 3 columns, its level headers (after the first column), by shape: '9a: 9+', '9:9 (9-9)'");
  expect(some).toContain("export the rubric as xlsx or csv instead");
});

test("a header is described by its shape, never by what it says", () => {
  expect(shapeOf("Excellent (85)")).toBe("Aa (9)");
  expect(shapeOf("78, 75, 72 (1st)")).toBe("9, 9, 9 (9a)");
  expect(shapeOf("Très bien – ٨٥")).toBe("Aa?a a ? ?"); // anything outside ASCII is one mark
});

test("a header that two layouts read differently is rejected, not chosen by the order of the layouts", async () => {
  // '(1)' is a band for one layout and the points for the other: 75 or 1.
  const problems = await problemsOf(importFile("ambiguous.xlsx", xlsx([["", "78, 75, 72 (1)", "68, 65, 62 (2)"], ["Analysis", "a", "b"]])));
  expect(problems).toContain(
    "column 2 header (shape '9, 9, 9 (9)') can be read two ways, 'Label (points)' makes it worth 1, but marks, then an optional band in brackets makes it worth 75; change the header so that only one fits",
  );
  expect(problems).toContain("column 3 header (shape '9, 9, 9 (9)') can be read two ways");
  // Where both layouts read the same points, there is nothing to choose between.
  const same = await importFile("same.xlsx", xlsx([["", "50 (50)"], ["Analysis", "a"]]));
  expect(same.rubric.criteria[0].levels[0].points).toBe(50);
});

test("a weight entered by hand is what the note says is used, not the one in the name", async () => {
  const rows = [["", "Good (60)"], ["Research question (25%)", "a"], ["Method (30%)", "b"]];
  const { warnings } = await importFile("w.xlsx", xlsx(rows), { weights: { "research-question": 40 } });
  expect(warnings).toEqual([
    "xlsx: row 2 'Research question' has a weight of 25 in its name, but the weight entered, 40, is used",
    "xlsx: row 3 'Method' is weighted 30, read from '(30%)' in its name",
  ]);
});
