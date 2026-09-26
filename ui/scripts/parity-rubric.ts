/**
 * Parity with the Python reference (#49): rubrics imported by `core/` and by
 * the TypeScript core from the same files, and the results compared in full
 * (rubric, warnings, whether it was written, or the list of problems). The
 * files are the synthetic pack, CSV and JSON written here, workbooks written
 * by openpyxl itself and by hand (for what openpyxl doesn't write), and docx
 * tables written by python-docx. Where the two differ on purpose, the case
 * says why, and the TypeScript problem it must give.
 *
 * Before that, the Python number, text and csv helpers are fuzzed against
 * Python itself.
 *
 *   node scripts/parity-rubric.ts      (needs uv and the core environment)
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { csvDictRows, csvRows } from "../src/core/csv.ts";
import { bytesSource, importRubric, RubricError, type ImportRubricOptions, type Workspace } from "../src/core/index.ts";
import { parsePyJson, pyFloat, pyFormatG, pyInt, pyReprFloat, pyReprStr, pySplitlines, pyStr } from "../src/core/pytext.ts";
import { PACK, xlsx } from "../test/builders.ts";

const python = (code: string, input = "") =>
  execFileSync("uv", ["run", "--quiet", "--project", "../core", "python", "-c", code], { input, encoding: "utf8", maxBuffer: 1 << 28 });

let failures = 0;
const check = (what: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${!ok && detail ? `\n    ${detail}` : ""}`);
};

// --- 1. Helpers, fuzzed against Python ------------------------------------------------

let seed = 49;
const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)];
const view = new DataView(new ArrayBuffer(8));
const doubles = [0.5, 1234565, 1234575, 0.0001, 0.00001, 1e16, 1e15, 1e21, 1e-7, 0.1 + 0.2, 999999.5, 9999995, 5e-324, 1.7976931348623157e308, 68.5, 12345650000];
for (let i = 0; i < 4000; i++) {
  view.setUint32(0, Math.floor(random() * 2 ** 32));
  view.setUint32(4, Math.floor(random() * 2 ** 32));
  if (Number.isFinite(view.getFloat64(0))) doubles.push(view.getFloat64(0));
  doubles.push(Math.round(random() * 10 ** Math.floor(random() * 12)) / 10 ** Math.floor(random() * 8));
}
const numberTexts = [" 85 ", "85%", "1_000", "1__0", "_1", "1_", "1_.5", ".5", "5.", ".", "1e1_0", "inf", "-Infinity", "nan", "٨٥", "８５", "𝟖𝟓", "0x10", "   7 \x1c", "7﻿", "0_7", "１.５", "12345678901234567890123"];
for (let i = 0; i < 4000; i++) numberTexts.push(Array.from({ length: 1 + Math.floor(random() * 6) }, () => pick([..."10_.eE+- 59inf٣"])).join(""));
const texts: string[] = [];
const textAlphabet = ["a", "\n", "\r", "\r\n", "\v", "\f", "\x1c", "\x1d", "\x1e", "\x1f", "\x85", " ", " ", " ", "'", '"', "\\", "\t", "\x00", "\x7f", "é", "​", "\ud800", "😀", " "];
for (let i = 0; i < 4000; i++) texts.push(Array.from({ length: Math.floor(random() * 6) }, () => pick(textAlphabet)).join(""));
const csvTexts = ["", "\n", "a,b\n\n1,2\n", "a,b\r\n1\r\n", 'a,"b\nc",d', '"a"b,c', 'a,"b', "a\rb", "\na,b\n1,2,3\n", "a,b,a\n1,2\n"];
for (let i = 0; i < 6000; i++) csvTexts.push(Array.from({ length: Math.floor(random() * 14) }, () => pick(["a", "b", ",", ",", '"', '"', "\n", "\r", "\r\n", " ", "\x00", "é"])).join(""));

// Random JSON documents: integer-like and repeated keys, every number form, escapes.
const jsonTexts: string[] = ['{"2": "b", "1": "a"}', '{"a": 1, "b": 2, "a": 3}', "[1, 1.0, -0, 1e400, 1E-7, 12345678901234567890]", '"\\u00e9\\ud83d\\ude00\\n"'];
const jsonValue = (depth: number): string => {
  const r = random();
  if (depth > 2 || r < 0.4) return pick(["0", "-0", "1.0", "85", "1e3", "2.5E-3", "123456789012345678901", "true", "false", "null", '"x"', '"it\'s"', '"q\\"d"', '"\\t\\u0001"', '""']);
  if (r < 0.7) return `[${Array.from({ length: Math.floor(random() * 3) }, () => jsonValue(depth + 1)).join(", ")}]`;
  return `{${Array.from({ length: Math.floor(random() * 4) }, () => `${pick(['"1"', '"2"', '"10"', '"a"', '"b"', '"-1"', '"01"'])}: ${jsonValue(depth + 1)}`).join(", ")}}`;
};
for (let i = 0; i < 3000; i++) jsonTexts.push(jsonValue(0));

const fromPython = JSON.parse(
  python(
    `
import csv, io, json, sys
d = json.loads(sys.stdin.read())
def attempt(f, s):
    try: return f(s)
    except ValueError: return None
def rows(t):
    try: return list(csv.reader(io.StringIO(t)))
    except csv.Error as e: return "error: " + str(e)
def dict_rows(t):
    try:
        r = csv.DictReader(io.StringIO(t))
        return {"f": r.fieldnames, "rows": [[[k, v] for k, v in row.items()] for row in r]}
    except csv.Error as e: return "error: " + str(e)
print(json.dumps({
    "repr": [repr(float(x)) for x in d["doubles"]], "g": [format(float(x), "g") for x in d["doubles"]],
    "float": [attempt(lambda s: repr(float(s)), s) for s in d["numbers"]], "int": [attempt(lambda s: str(int(s)), s) for s in d["numbers"]],
    "lines": [t.splitlines() for t in d["texts"]], "repr_str": [repr(t) for t in d["texts"]],
    "csv": [[rows(t), dict_rows(t)] for t in d["csv"]],
    "json": [str(json.loads(t)) for t in d["json"]],
}))
`,
    JSON.stringify({ doubles: doubles.map(String), numbers: numberTexts, texts, csv: csvTexts, json: jsonTexts }),
  ),
);
const mismatches = (pairs: [unknown, unknown, unknown][]) => pairs.filter(([got, want]) => !isDeepStrictEqual(got, want));
const report = (what: string, pairs: [unknown, unknown, unknown][]) => {
  const bad = mismatches(pairs);
  check(`${what} (${pairs.length} inputs)`, bad.length === 0, bad.slice(0, 3).map(([got, want, input]) => `${JSON.stringify(input)}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`).join("\n    "));
};
report("repr(float) matches Python", doubles.map((x, i) => [pyReprFloat(x), fromPython.repr[i], x]));
report("format(float, 'g') matches Python", doubles.map((x, i) => [pyFormatG(x), fromPython.g[i], x]));
report("float(str) matches Python", numberTexts.map((s, i) => { const x = pyFloat(s); return [x === null ? null : pyReprFloat(x), fromPython.float[i], s]; }));
report("int(str) matches Python", numberTexts.map((s, i) => [pyInt(s)?.toString() ?? null, fromPython.int[i], s]));
report("str.splitlines() matches Python", texts.map((t, i) => [pySplitlines(t), fromPython.lines[i], t]));
report("repr(str) matches Python", texts.map((t, i) => [pyReprStr(t), fromPython.repr_str[i], t]));
const attempt = (run: () => unknown) => { try { return run(); } catch (err) { return "error: " + (err as Error).message; } };
report("str(json.loads(text)) matches Python", jsonTexts.map((t, i) => [pyStr(parsePyJson(t)), fromPython.json[i], t]));
report("csv.reader matches Python", csvTexts.map((t, i) => [attempt(() => csvRows(t)), fromPython.csv[i][0], t]));
report("csv.DictReader matches Python", csvTexts.map((t, i) => [attempt(() => { const d = csvDictRows(t); return { f: d.fieldnames, rows: d.rows.map((m) => [...m.entries()]) }; }), fromPython.csv[i][1], t]));

// --- 2. Rubric imports ---------------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), "rubric-parity-"));
const NOW = "2026-01-15T09:00:00.000+00:00";
interface Case {
  file: string;
  options?: Pick<ImportRubricOptions, "title" | "weights" | "sheet" | "confirm">;
  /** An intended difference: why, and a problem the TypeScript core must list. */
  differs?: { why: string; ts: string };
}
const cases: Case[] = [];
const write = (name: string, content: string | Uint8Array) => writeFileSync(join(dir, name), content);
const add = (file: string, options?: Case["options"], differs?: Case["differs"]) => cases.push({ file, options, differs });

for (const name of ["rubric.csv", "rubric.json", "rubric-grid.xlsx", "rubric-grid.docx"]) copyFileSync(new URL(name, PACK), join(dir, name));
add("rubric.csv", { title: "Synthetic rubric" });
add("rubric.json");
add("rubric-grid.xlsx", { title: "Grid" });
add("rubric-grid.docx", { confirm: true });
add("rubric-grid.xlsx", { weights: { implementation: 25, "requirements-and-design": 25 } });
add("rubric-grid.xlsx", { weights: { nope: 10, implementation: 5 } });
add("rubric.csv", { weights: { implementation: 0 } });

const HEAD = "criterion,level_label,points,descriptor";
write("quirks.csv", "﻿ Criterion ,LEVEL_LABEL,points,descriptor,weight,max_points,criterion_description,\r\n" +
  'Analysis,1ST (85),85,"Excellent,\r\nthorough.",,,Reads\\nwell,extra\r\n' +
  "Analysis,Also (85),85,Repeated points.,25%\r\n\r\n" +
  "Analysis,Half,68.5,Half points.,,100\r\n" +
  "analysis!,No points,,Level without points.\r\n" +
  "Design,Tiny (0),0.00001,Tiny.\r\nDesign,Digits,٨٥,Unicode digits.\r\nDesign,Under,1_0,Underscores.\r\n" +
  " ,Skipped,1,Row without a criterion.\r\n");
add("quirks.csv");
write("short-row.csv", `${HEAD}\nDesign,Good (60),60,Clear.\nDesign,Short\n`);
add("short-row.csv");
write("problems.csv", `${HEAD}\nAnalysis,1ST (85),eighty,Excellent.\nAnalysis,,40,Weak.\nDesign,2:1 (65),65,\nEmpty,,,\n`);
add("problems.csv");
write("dup-headers.csv", `${HEAD},points\nAnalysis,Good (60),60,Clear.,70\n`);
add("dup-headers.csv");
write("blank-first.csv", `\n${HEAD}\nAnalysis,Good (60),60,Clear.\n`);
add("blank-first.csv");
write("empty.csv", "");
add("empty.csv");
write("header-only.csv", `${HEAD}\n`);
add("header-only.csv");
write("weights.csv", `${HEAD},weight,max_points\nA,Good (60),60,Clear.,nan,0\nB,Good (60),60,Clear.,-5,x\n`);
add("weights.csv");
write("carriage-return.csv", `${HEAD}\nA,B (1),1,x\ry\n`);
add("carriage-return.csv", undefined, { why: "Python's csv.Error escapes unhandled", ts: "CSV could not be read: new-line character seen" });
write("latin-1.csv", new Uint8Array([...Buffer.from(`${HEAD}\nA,B (1),1,caf`), 0xe9, 0x0a]));
add("latin-1.csv", undefined, { why: "Python's UnicodeDecodeError escapes unhandled", ts: "CSV could not be read: it is not UTF-8 text" });
write("negative.csv", `${HEAD}\nA,Odd (-5),-5,Strange.\n`);
add("negative.csv", undefined, { why: "Python's pydantic ValidationError escapes unhandled", ts: "Input should be greater than or equal to 0" });
write("big-points.csv", `${HEAD}\nA,Big,1234567,Huge.\n`);
add("big-points.csv", undefined, { why: "the level id 'p1-23457e+06' is invalid; Python's ValidationError escapes", ts: "is not a valid identifier" });
write("infinite.csv", `${HEAD}\nA,Endless,inf,Forever.\n`);
add("infinite.csv", undefined, { why: "Python accepts infinity, then writes a bare Infinity, which isn't JSON", ts: "Input should be a finite number" });

write("numbers.json", '{"title": 1.0, "criteria": [{"title": "A", "weight": 25.0, "max_points": 100, "levels": [{"label": 85.0, "points": "85%", "descriptor": 12345678901234567890}]}]}');
add("numbers.json");
write("nulls.json", '{"title": null, "criteria": [{"title": null, "levels": [{"label": true, "points": null, "descriptor": {"a": [1, "x\'y", 2.5, false]}}]}]}');
add("nulls.json");
write("bad-values.json", '{"criteria": [{"title": "A", "weight": [1], "levels": [{"label": "L", "points": true, "descriptor": "D"}]}]}');
add("bad-values.json");
write("duplicates.json", '{"criteria": [{"title": "Analysis", "levels": [{"label": "A", "points": 5, "descriptor": "x"}, {"label": "B", "points": 5, "descriptor": "y"}]}, {"title": "analysis!", "levels": [{"label": "C", "descriptor": "z"}]}, {"title": "Empty", "levels": []}]}');
add("duplicates.json");
write("key-order.json", '{"criteria": [{"title": "A", "levels": [{"label": "L", "points": 1, "descriptor": {"2": "b", "1": "a", "2": "c"}}]}]}');
add("key-order.json");
write("no-criteria.json", '{"criteria": []}');
add("no-criteria.json");
write("bom.json", '﻿{"title": "With BOM", "criteria": [{"title": "A", "levels": [{"label": "L", "points": 1, "descriptor": "D"}]}]}');
add("bom.json", { title: "Given title" });
["[]", '{"criteria": "x"}', '{"criteria": [1]}', '{"criteria": [{"title": "A", "levels": {}}]}'].forEach((payload, i) => {
  write(`shape-${i}.json`, payload);
  add(`shape-${i}.json`);
});
write("nan.json", '{"criteria": [{"title": "A", "levels": [{"label": "L", "points": NaN, "descriptor": "D"}]}]}');
add("nan.json", undefined, { why: "Python's json accepts NaN (and its ValidationError then escapes); JSON has no NaN", ts: "JSON could not be parsed" });
write("broken.json", "{");
add("broken.json", undefined, { why: "the parser's own message differs", ts: "JSON could not be parsed" });
write("rubric.odt", "");
add("rubric.odt");

// Hand-written workbooks, for what openpyxl doesn't write.
const si = ["<si><t>Rich </t><r><rPr/><t>text</t></r><rPh sb='0' eb='1'><t>ignored</t></rPh></si>", "<si><t>Esc_x005F_x000D_aped</t></si>"];
write("hand.xlsx", xlsx([
  ["", "Good (60)", "Fair (40)", "Weak (20)", "Poor (10)"],
  ["Analysis", { xml: '<c r="{ref}" t="s"><v>0</v></c>' }, { xml: '<c r="{ref}" t="s"><v>1</v></c>' }, { xml: '<c r="{ref}" t="inlineStr"><is><r><t>In</t></r><r><t>line</t></r></is></c>' }, { xml: '<c r="{ref}" t="e"><v>#N/A</v></c>' }],
  ["Design", { xml: '<c r="{ref}" t="str"><f>A1</f><v>Formula text</v></c>' }, { xml: '<c r="{ref}" t="b"><v>2</v></c>' }, { xml: '<c r="{ref}" t="s"><v>-1</v></c>' }, 1e-5],
], { si }));
add("hand.xlsx");
write("no-refs.xlsx", xlsx([["", "Good (60)"], ["Analysis", "Clear."]]).slice()); // replaced below
{
  // Cells and rows without references, and a row out of order (openpyxl skips it).
  const sheet = '<sheetData><row><c t="inlineStr"><is><t></t></is></c><c t="inlineStr"><is><t>Good (60)</t></is></c></row><row><c t="inlineStr"><is><t>Analysis</t></is></c><c t="inlineStr"><is><t>Clear.</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Skipped</t></is></c></row></sheetData>';
  const zip = xlsx([["x"]], { dimension: null });
  const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
  const members = unzipSync(zip);
  members["xl/worksheets/sheet1.xml"] = strToU8(strFromU8(members["xl/worksheets/sheet1.xml"]).replace(/<sheetData>.*<\/sheetData>/s, sheet));
  write("no-refs.xlsx", zipSync(members));
}
add("no-refs.xlsx");
const wide: (string | number)[][] = [["", "Good (60)", "Fair (40)"], ["Analysis", "Clear.", "Vague."], ["Design", "Neat.", "Messy."]];
write("dim-small.xlsx", xlsx(wide, { dimension: "A1:B2" }));
add("dim-small.xlsx");
write("dim-a1.xlsx", xlsx(wide, { dimension: "A1" }));
add("dim-a1.xlsx");
write("no-dimension.xlsx", xlsx(wide, { dimension: null }));
add("no-dimension.xlsx");
write("date-outside.xlsx", xlsx([["", "Good (60)"], ["Analysis", "Clear.", { xml: '<c r="{ref}" t="d"><v>2026-01-02</v></c>' }]], { dimension: "A1:B2" }));
add("date-outside.xlsx");
write("date-style.xlsx", xlsx([["", "Good (60)"], ["Analysis", { xml: '<c r="{ref}" s="1"><v>46024</v></c>' }]], { numFmts: { 164: "d/m/yyyy" }, cellXfs: [0, 164] }));
add("date-style.xlsx", undefined, { why: "openpyxl reads a date, which Python writes as '2026-01-02 00:00:00'", ts: "cell B2 holds a date or time" });
write("bad-number-outside.xlsx", xlsx([["", "Good (60)"], ["Analysis", "Clear."], ["Design", { xml: '<c r="{ref}"><v>abc</v></c>' }]], { dimension: "A1:B2" }));
add("bad-number-outside.xlsx", undefined, { why: "openpyxl decodes the first row past the dimension before stopping, and its ValueError escapes", ts: "xlsx could not be read" });
write("bad-number.xlsx", xlsx([["", "Good (60)"], ["Analysis", { xml: '<c r="{ref}"><v>abc</v></c>' }]]));
add("bad-number.xlsx", undefined, { why: "Python's ValueError escapes unhandled", ts: "xlsx could not be read" });
write("corrupt.xlsx", "not a workbook");
add("corrupt.xlsx", undefined, { why: "openpyxl's own message differs", ts: "xlsx could not be read" });
write("sheets.xlsx", xlsx({ Notes: [["nothing here"]], Rubric: [["", "Good (60)"], ["Analysis", "Clear."]] }));
add("sheets.xlsx");
add("sheets.xlsx", { sheet: "Rubric" });
add("sheets.xlsx", { sheet: "Missing" });
write("corrupt.docx", "not a docx");
add("corrupt.docx", undefined, { why: "the error's type name differs", ts: "docx could not be read" });

// Workbooks and documents written by openpyxl and python-docx.
python(`
import sys
from datetime import datetime
from pathlib import Path
sys.path.insert(0, "../core/tests")
import openpyxl
from docx import Document
from helpers import docx_with_table
out = Path(${JSON.stringify(dir)})

wb = openpyxl.Workbook(); ws = wb.active
ws.append(["", "Good (60)", "Fair (40)", "Weak (20)", "Half (68.5)", "Zero (0)"])
ws.append(["Analysis\\nReads the brief\\r\\nand more\\u2028still", 7, 7.5, True, 1e-05, 12345678901234567890])
ws.append(["Design", "Ünïcode 🙂", "x", "  padded  ", "Lit\\\\nnewline", 0])
wb.save(out / "openpyxl-values.xlsx")

wb = openpyxl.Workbook(); ws = wb.active
ws.append(["", "Good (60)", "Fair (40)"]); ws.append(["Analysis", "=1+1", None])
wb.save(out / "openpyxl-formula.xlsx")

wb = openpyxl.Workbook(); ws = wb.active
ws.append(["", "Good (60)", "Fair (40)"]); ws.append(["Analysis", "Clear.", "Vague."])
ws.merge_cells("B1:C1")
wb.save(out / "openpyxl-merged.xlsx")

wb = openpyxl.Workbook(); ws = wb.active
ws["C3"] = "Good (60)"; ws["B3"] = ""; ws["A4"] = "Analysis"; ws["C4"] = "Clear."; ws["B4"] = "Stray"
wb.save(out / "openpyxl-offset.xlsx")

wb = openpyxl.Workbook(); ws = wb.active
ws.append(["", "Good (٨٥)", "Ｆａｉｒ (40)", "Weak ( 20 )", "Bad (2O)"]); ws.append(["Analysis", "a", "b", "c", "d"])
wb.save(out / "openpyxl-unicode.xlsx")

wb = openpyxl.Workbook(); ws = wb.active
ws.append(["", "Good (٨٥)", "Ｆａｉｒ (40)", "Weak ( 20 )", "Nbsp\\u00a0(10)", "Very  good\\n(75)"]); ws.append(["Analysis", "a", "b", "c", "d", "e"])
wb.save(out / "openpyxl-unicode-ok.xlsx")

wb = openpyxl.Workbook(); ws = wb.active
ws.append(["", "Good (60)"]); ws.append(["Analysis", datetime(2026, 1, 2)])
wb.save(out / "openpyxl-date.xlsx")

doc = Document()
t = doc.add_table(rows=1, cols=2); t.cell(0, 0).text = "Name"; t.cell(0, 1).text = "Value"
g = doc.add_table(rows=4, cols=4)
for c, text in enumerate(["", "Good (60)", "", "Weak (20)"]): g.cell(0, c).text = text
g.cell(0, 1).merge(g.cell(0, 2))
g.cell(1, 0).merge(g.cell(2, 0)).text = "Analysis\\nMerged down"
for r in (1, 2, 3):
    for c in (1, 2, 3): g.cell(r, c).text = f"R{r}C{c}"
g.cell(3, 0).text = "Design"
g.cell(3, 0).add_table(rows=1, cols=1).cell(0, 0).text = "Nested"
doc.save(out / "python-docx-grid.docx")

doc = Document()
e = doc.add_table(rows=3, cols=3)
e.cell(1, 0).text = "Analysis"; e.cell(1, 1).text = "Good (60)"; e.cell(2, 0).text = "Design"; e.cell(2, 1).text = "Clear."
doc.save(out / "python-docx-empty-header.docx")

doc = Document()
outer = doc.add_table(rows=1, cols=1)
inner = outer.cell(0, 0).add_table(rows=2, cols=2)
inner.cell(0, 1).text = "Good (60)"; inner.cell(1, 0).text = "Analysis"; inner.cell(1, 1).text = "Clear."
doc.save(out / "python-docx-nested.docx")

docx_with_table(out / "python-docx-table.docx")
`);
for (const name of ["openpyxl-values.xlsx", "openpyxl-formula.xlsx", "openpyxl-unicode-ok.xlsx", "openpyxl-merged.xlsx", "openpyxl-offset.xlsx", "openpyxl-unicode.xlsx", "python-docx-grid.docx", "python-docx-empty-header.docx", "python-docx-nested.docx", "python-docx-table.docx"]) add(name);
add("openpyxl-values.xlsx", { weights: { analysis: 12.5 }, title: "Weighted" });
add("openpyxl-date.xlsx", undefined, { why: "openpyxl reads a date, which Python writes as '2026-01-02 00:00:00'", ts: "holds a date or time" });

type Outcome = { rubric: unknown; warnings: string[]; written: boolean } | { problems: string[] } | { crash: string; message: string };
const pythonOutcomes = JSON.parse(
  python(
    `
import json, sys, tempfile
from datetime import datetime
from pathlib import Path
from feedbacker_core.rubric_import import RubricError, import_rubric
from feedbacker_core.workspace import Workspace
out = Path(${JSON.stringify(dir)})
root = Path(tempfile.mkdtemp())
now = datetime.fromisoformat(${JSON.stringify(NOW)})
results = []
for i, case in enumerate(json.loads(sys.stdin.read())):
    ws = Workspace.create(f"w{i}", root=root)
    try:
        rubric, warnings, written = import_rubric(ws, out / case["file"], now=now, **(case.get("options") or {}))
        results.append({"rubric": rubric.model_dump(mode="json"), "warnings": warnings, "written": written})
    except RubricError as err:
        results.append({"problems": err.problems})
    except Exception as err:
        results.append({"crash": type(err).__name__, "message": str(err)})
# Python writes infinity and NaN as bare tokens, which JSON doesn't allow; show them as text.
print(json.dumps(json.loads(json.dumps(results), parse_constant=lambda c: f"<{c}>")))
`,
    JSON.stringify(cases),
  ),
) as Outcome[];

const workspace = {
  exists: async () => false,
  writeJson: async () => {},
  fs: { readText: async () => null, writeText: async () => {}, remove: async () => {} },
} as unknown as Workspace;
for (const [i, c] of cases.entries()) {
  let ts: Outcome;
  try {
    const bytes = new Uint8Array(readFileSync(join(dir, c.file)));
    const result = await importRubric(workspace, bytesSource(c.file, bytes), { ...c.options, now: new Date(NOW) });
    ts = JSON.parse(JSON.stringify(result));
  } catch (err) {
    ts = err instanceof RubricError ? { problems: err.problems } : { crash: (err as Error).name, message: (err as Error).message };
  }
  const py = pythonOutcomes[i];
  const label = `${c.file}${c.options ? ` ${JSON.stringify(c.options)}` : ""}`;
  const summary = (o: Outcome) => ("rubric" in o ? `rubric (${o.written ? "written" : "preview"})` : "problems" in o ? `problems: ${o.problems.join(" / ")}` : `unhandled ${o.crash}: ${o.message}`);
  if (c.differs) {
    const ok = "problems" in ts && ts.problems.some((p) => p.includes(c.differs!.ts)) && !isDeepStrictEqual(ts, py);
    check(`${label}: differs on purpose (${c.differs.why})`, ok, `python: ${summary(py)}\n    typescript: ${summary(ts)}`);
  } else {
    const same = isDeepStrictEqual(ts, py) && !("crash" in py);
    check(`${label}: ${summary(py).slice(0, 90)}`, same, `python: ${JSON.stringify(py).slice(0, 600)}\n    typescript: ${JSON.stringify(ts).slice(0, 600)}`);
  }
}
rmSync(dir, { recursive: true, force: true });
console.log(`${failures ? "FAIL" : "PASS"}: ${cases.length} imports and 9 fuzzed helpers compared with Python`);
process.exit(failures ? 1 : 0);
