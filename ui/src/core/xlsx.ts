/**
 * Read a worksheet's cell values from an .xlsx file, as the Python reference
 * reads them with openpyxl 3.1 (`load_workbook(read_only=True,
 * data_only=True)`, then `iter_rows(values_only=True)`). Each value is given
 * as Python's `str()` of openpyxl's value, or null for an empty cell.
 *
 * The zip and XML are read directly, with fflate and saxes (see the README
 * for why no xlsx library is used). Only what a rubric grid needs is read:
 * the workbook's sheet list, shared strings, number formats (to recognise
 * dates) and the cells. Formulas give their cached values.
 *
 * One deliberate difference: openpyxl turns a date-formatted number into a
 * date, and Python then writes it as text such as "2026-01-02 00:00:00".
 * Here a date or time cell is an error, because a rubric grid never needs one
 * and Excel turns text such as "1/2" into a date unasked.
 */

import { DocxPackage } from "./docx.ts";
import { pyFloat, pyInt, pyReprFloat } from "./pytext.ts";
import { attr, childOf, childrenOf, descendants, elements, ownText, type XmlElement } from "./xml.ts";

export class XlsxError extends Error {}

/** The named sheet isn't in the workbook. */
export class XlsxNoSheet extends XlsxError {}

/** A date or time value, which is an error only if it is read (openpyxl drops cells outside the sheet's dimension). */
const DATE: unique symbol = Symbol("date");

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const WORKBOOK_TYPES = [
  "application/vnd.ms-excel.template.macroEnabled.main+xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
  "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
];
const SHARED_STRINGS = "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml";

/** openpyxl's built-in number formats (the others it doesn't know, so never dates). */
const BUILTIN_FORMATS: Record<number, string> = {
  0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 5: '"$"#,##0_);("$"#,##0)', 6: '"$"#,##0_);[Red]("$"#,##0)',
  7: '"$"#,##0.00_);("$"#,##0.00)', 8: '"$"#,##0.00_);[Red]("$"#,##0.00)', 9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?",
  13: "# ??/??", 14: "mm-dd-yy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm",
  21: "h:mm:ss", 22: "m/d/yy h:mm", 37: "#,##0_);(#,##0)", 38: "#,##0_);[Red](#,##0)", 39: "#,##0.00_);(#,##0.00)",
  40: "#,##0.00_);[Red](#,##0.00)", 41: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)', 42: '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)', 44: '_("$"* #,##0.00_)_("$"* \\(#,##0.00\\)_("$"* "-"??_)_(@_)',
  45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@",
};

/** openpyxl's `is_date_format`: date or time letters outside quotes and (most) brackets. */
export function isDateFormat(format: string | undefined): boolean {
  if (format === undefined) return false;
  const first = format.split(";")[0].replace(/".*?"|\[(?!hh?\]|mm?\]|ss?\])[^\]]*\]/gs, "");
  return /(?<![_\\])[dmhysDMHYS]/.test(first);
}

/** 1-based column number of letters A..ZZZ, or null. */
function columnIndex(letters: string): number | null {
  if (!/^[A-Za-z]{1,3}$/.test(letters)) return null;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** openpyxl's `range_boundaries` for a `<dimension ref>`: [maxColumn, maxRow], either possibly null. */
function dimensionBounds(ref: string): [number | null, number | null] {
  const bad = () => new XlsxError(`${ref} is not a valid coordinate or range`);
  const m = /^\$?([A-Za-z]{1,3})?\$?(\p{Nd}+)?(:\$?([A-Za-z]{1,3})?\$?(\p{Nd}+)?)?$/u.exec(ref);
  if (!m) throw bad();
  const [, minCol, minRow, sep, maxCol, maxRow] = m;
  if (sep) {
    const cols = [minCol, maxCol];
    const rows = [minRow, maxRow];
    const all = (xs: (string | undefined)[]) => xs.every(Boolean);
    const any = (xs: (string | undefined)[]) => xs.some(Boolean);
    if (!(all([...cols, ...rows]) || (all(cols) && !any(rows)) || (all(rows) && !any(cols)))) throw bad();
  }
  const col = (s: string | undefined) => (s === undefined ? null : columnIndex(s));
  const row = (s: string | undefined) => (s === undefined ? null : Number(pyInt(s)));
  return [maxCol !== undefined ? col(maxCol) : col(minCol), maxRow !== undefined ? row(maxRow) : row(minRow)];
}

/** openpyxl's `Text.content`: the plain text, then each run's, by local name only. */
function textContent(e: XmlElement): string {
  let plain = "";
  const runs: string[] = [];
  for (const child of elements(e)) {
    if (child.local === "t") plain = ownText(child); // the last one wins, as in openpyxl
    else if (child.local === "r") {
      const t = elements(child).filter((c) => c.local === "t").at(-1);
      if (t) runs.push(ownText(t));
    }
  }
  return plain + runs.join("");
}

/** Where Python's `int()` fails on a value openpyxl reads, it raises; so does this. */
function mustInt(text: string, what: string): bigint {
  const n = pyInt(text);
  if (n === null) throw new XlsxError(`${what} '${text}' is not a whole number`);
  return n;
}

interface Workbook {
  pkg: DocxPackage;
  sheets: { name: string; target: string; chart: boolean }[];
  sharedStrings: string[];
  dateStyles: Set<number>;
}

async function openWorkbook(bytes: Uint8Array): Promise<Workbook> {
  const pkg = await DocxPackage.open(bytes, "xlsx");
  const types = await pkg.xml("[Content_Types].xml");
  if (!types) throw new XlsxError("the package has no content types");
  const overrides = childrenOf(types, CT, "Override");
  const partOf = (type: string) => overrides.find((o) => o.attrs.get("ContentType") === type)?.attrs.get("PartName")?.slice(1);
  let workbookPath = WORKBOOK_TYPES.map(partOf).find((p) => p !== undefined);
  if (workbookPath === undefined) {
    const defaults = new Set(childrenOf(types, CT, "Default").map((d) => d.attrs.get("ContentType")));
    if (!WORKBOOK_TYPES.some((t) => defaults.has(t))) throw new XlsxError("File contains no valid workbook part");
    workbookPath = "xl/workbook.xml";
  }

  const workbook = await pkg.xml(workbookPath);
  if (!workbook) throw new XlsxError(`there is no item named '${workbookPath}' in the archive`);
  const rels = await pkg.relationships(workbookPath);
  const present = pkg.names();
  const sheets: Workbook["sheets"] = [];
  for (const sheet of descendants(workbook, MAIN, "sheet")) {
    const id = attr(sheet, REL, "id");
    if (!id) continue; // openpyxl warns and skips it
    const rel = rels.get(id);
    if (!rel) throw new XlsxError(`'${id}'`);
    if (!present.has(rel.target)) continue;
    sheets.push({ name: sheet.attrs.get("name") ?? "", target: rel.target, chart: rel.type.includes("chartsheet") });
  }

  const stringsPath = partOf(SHARED_STRINGS);
  const strings = stringsPath === undefined ? null : await pkg.xml(stringsPath);
  const sharedStrings = strings ? descendants(strings, MAIN, "si").map((si) => textContent(si).replaceAll("x005F_", "")) : [];

  const dateStyles = new Set<number>();
  const styles = await pkg.xml("xl/styles.xml");
  if (styles) {
    const custom = new Map<number, string>();
    for (const f of descendants(styles, MAIN, "numFmt")) {
      custom.set(Number(mustInt(f.attrs.get("numFmtId") ?? "", "number format id")), f.attrs.get("formatCode") ?? "");
    }
    const cellXfs = childOf(styles, MAIN, "cellXfs");
    (cellXfs ? childrenOf(cellXfs, MAIN, "xf") : []).forEach((xf, index) => {
      const id = Number(mustInt(xf.attrs.get("numFmtId") ?? "0", "number format id"));
      if (isDateFormat(custom.has(id) ? custom.get(id) : BUILTIN_FORMATS[id])) dateStyles.add(index);
    });
  }
  return { pkg, sheets, sharedStrings, dateStyles };
}

/** The sheet names, as openpyxl's `sheetnames` (chart sheets included). */
export async function xlsxSheetNames(bytes: Uint8Array): Promise<string[]> {
  return (await openWorkbook(bytes)).sheets.map((s) => s.name);
}

/**
 * The rows of a sheet (the first worksheet if `sheet` is null), as
 * `iter_rows(values_only=True)` gives them, with each value as `str()`.
 * Throws XlsxError where openpyxl fails to load the file, and also where
 * reading it would crash in Python or give a date.
 */
export async function readXlsxRows(bytes: Uint8Array, sheet: string | null = null): Promise<(string | null)[][]> {
  const book = await openWorkbook(bytes);
  if (sheet !== null && !book.sheets.some((s) => s.name === sheet)) throw new XlsxNoSheet(`no sheet '${sheet}'`);
  // As Python's `wb[sheet] if sheet else wb.worksheets[0]`.
  const chosen = sheet ? book.sheets.find((s) => s.name === sheet) : book.sheets.find((s) => !s.chart);
  if (!chosen) throw new XlsxError("the workbook has no worksheet");
  if (chosen.chart) throw new XlsxError(`sheet '${chosen.name}' is a chart, not a worksheet`);
  const root = await book.pkg.xml(chosen.target);
  if (!root) throw new XlsxError(`there is no item named '${chosen.target}' in the archive`);

  const dimension = descendants(root, MAIN, "dimension")[0];
  const [maxCol, maxRow] = dimension ? dimensionBounds(dimension.attrs.get("ref") ?? "") : [null, null];

  const out: (string | null)[][] = [];
  const emptyRow = (): (string | null)[] => (maxCol === null ? [] : Array(maxCol).fill(null));
  let counter = 1;
  let rowCounter = 0;
  for (const row of descendants(root, MAIN, "row")) {
    const r = row.attrs.get("r");
    if (r !== undefined) {
      const whole = pyInt(r);
      const real = whole === null ? pyFloat(r) : null;
      if (whole === null && (real === null || !Number.isInteger(real))) throw new XlsxError(`${r} is not a valid row number`);
      rowCounter = whole === null ? real! : Number(whole);
    } else rowCounter++;
    let colCounter = 0;
    const cells = elements(row).map((c): { column: number; where: string; value: string | null | typeof DATE } => {
      const coordinate = c.attrs.get("r");
      let column: number;
      if (coordinate) {
        const at = [...coordinate].findIndex((ch) => ch >= "0" && ch <= "9");
        const letters = at < 0 ? coordinate.slice(0, -1) : coordinate.slice(0, at);
        const index = columnIndex(letters);
        if (index === null) throw new XlsxError(`${letters} is not a valid column name`);
        mustInt(at < 0 ? coordinate.slice(-1) : coordinate.slice(at), "row number");
        column = colCounter = index;
      } else column = ++colCounter;
      return { column, where: coordinate ?? `R${rowCounter}C${column}`, value: cellValue(c, book) };
    });
    const idx = rowCounter;
    if (maxRow !== null && idx > maxRow) break;
    for (; counter < idx; counter++) out.push(emptyRow());
    if (counter <= idx) {
      counter++;
      if (!cells.length && maxCol === null) {
        out.push([]);
        continue;
      }
      const width = maxCol ?? cells.at(-1)!.column;
      const values: (string | null)[] = Array(width).fill(null);
      for (const cell of cells) {
        if (cell.column < 1 || cell.column > width) continue;
        if (cell.value === DATE) {
          throw new XlsxError(
            `cell ${cell.where} holds a date or time, which a rubric never needs (Excel may have turned text such as "1/2" into a date); make it text`,
          );
        }
        values[cell.column - 1] = cell.value;
      }
      out.push(values);
    }
  }
  return out;
}

/** One cell's value as openpyxl reads it (data only), as Python's `str()`. */
function cellValue(c: XmlElement, book: Workbook): string | null | typeof DATE {
  const type = c.attrs.get("t") ?? "n";
  const s = c.attrs.get("s");
  const style = s ? Number(mustInt(s, "style id")) : 0;
  if (type === "inlineStr") {
    const is = childOf(c, MAIN, "is");
    return is ? textContent(is) : null;
  }
  const v = childOf(c, MAIN, "v");
  const value = v ? ownText(v) : "";
  if (value === "") return null;
  switch (type) {
    case "n": {
      if (book.dateStyles.has(style)) return DATE;
      if (/[.eE]/.test(value)) {
        const x = pyFloat(value);
        if (x === null) throw new XlsxError(`could not convert string to float: '${value}'`);
        return pyReprFloat(x);
      }
      return mustInt(value, "number").toString();
    }
    case "s": {
      const strings = book.sharedStrings;
      let index = Number(mustInt(value, "shared string index"));
      if (index < 0) index += strings.length; // Python indexing
      if (index < 0 || index >= strings.length) throw new XlsxError("list index out of range");
      return strings[index];
    }
    case "b":
      return mustInt(value, "boolean") !== 0n ? "True" : "False";
    case "d":
      return DATE;
    default: // "str" (a formula's text), "e" (an error such as #N/A), or unknown
      return value;
  }
}
