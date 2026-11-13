/**
 * Import a rubric from CSV, JSON, or a grid in an xlsx sheet or docx table:
 * a port of `core/src/feedbacker_core/rubric_import.py`.
 *
 * Points-based rubrics in the Turnitin/Canvas style are supported: many levels
 * per criterion, each with one points value and a label. Labels are kept
 * exactly as written, even when inconsistent with their points. Literal `\n`
 * sequences, a common export artefact, are converted to line breaks in
 * descriptions and recorded as warnings.
 *
 * Grid (xlsx, or a docx table): criteria down the first column and levels
 * across the first row. Each level header must follow one of the named
 * layouts (see LAYOUTS), and all of them the same one: `Label (points)`, e.g.
 * `Excellent (85)`, or marks then an optional band in brackets, e.g.
 * `78, 75, 72 (1st)` (the middle mark stands for the level). The header is
 * kept exactly as written as the level label. A criterion cell's first line
 * is its title, which may end in its weight as a percentage (`Method (25%)`);
 * any further lines are its description. Grid imports are best-effort, so
 * they are previewed, with notes on how they were read, and written only when
 * the moderator confirms. A header that follows no layout is not guessed at.
 *
 * CSV: one row per level, with columns `criterion, level_label, points,
 * descriptor` and optionally `criterion_description, weight, max_points`
 * (criterion-level values may be given on any row of that criterion).
 *
 * JSON: `{"title", "criteria": [{"title", "description", "weight",
 * "max_points", "levels": [{"label", "points", "descriptor"}]}]}`.
 *
 * Values are read as Python reads them (its csv module, `float()`, `str()`),
 * so both cores build the same rubric from the same file.
 */

import { CsvError, csvDictRows } from "./csv.ts";
import { DocxError, readDocxTables } from "./docx.ts";
import { sha256Bytes } from "./extract.ts";
import { Criterion, Level, Rubric } from "./models.ts";
import { parsePyJson, pyFloat, pyFormatG, PyJsonNumber, pyReprFloat, pySplit, pySplitlines, pyStr, pyStrip, pyTruthy, WS } from "./pytext.ts";
import { DIGIT_CLASS } from "./ranges.ts";
import { ownerOf } from "./assessment.ts";
import type { Actor } from "./models.ts";
import { MODERATOR } from "./request.ts";
import type { Workspace } from "./workspace.ts";
import { WorkspaceError } from "./workspace.ts";
import { XlsxError, XlsxNoSheet, readXlsxRows } from "./xlsx.ts";
import { XmlError } from "./xml.ts";
import { ZipError, type ByteSource } from "./zip.ts";

export const RUBRIC = "rubric.json";
export const RUBRIC_WARNINGS = "rubric-warnings.json";
/** The record that a rubric entered from an image began as the AI's proposal (rubricReading.ts); only ever beside that rubric. */
export const RUBRIC_PROPOSAL = "rubric-proposal.json";
const REQUIRED_CSV = ["criterion", "level_label", "points", "descriptor"];
const GRID_FORMATS = new Set([".xlsx", ".docx"]);

/** The rubric is invalid. `problems` lists every issue found. */
export class RubricError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super("invalid rubric:\n- " + problems.join("\n- "));
    this.name = "RubricError";
    this.problems = problems;
  }
}

/**
 * Parsed but not yet validated: dictionaries as Python's parsers give them
 * (from JSON, a `Map` in written order; from CSV and grids, a plain object).
 */
type Raw = Record<string, unknown> | Map<string, unknown>;

function get(object: Raw, key: string, fallback: unknown = null): unknown {
  if (object instanceof Map) return object.has(key) ? object.get(key) : fallback;
  return Object.hasOwn(object, key) ? object[key] : fallback;
}
const isDict = (value: unknown): value is Raw =>
  value instanceof Map || (typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof PyJsonNumber));

export function slug(text: string): string {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (s || "criterion").slice(0, 60);
}

function clean(text: string, where: string, warnings: string[], keepEscapes = false): string {
  if (!keepEscapes && text.includes("\\n")) {
    warnings.push(`${where}: literal '\\n' sequences converted to line breaks`);
    text = text.replaceAll("\\n", "\n");
  }
  return pyStrip(text);
}

function number(value: unknown, where: string, problems: string[]): number | null {
  if (value === null || value === "") return null;
  const x = pyFloat(pyStrip(pyStr(value)).replace(/%+$/, ""));
  if (x === null) problems.push(`${where}: '${pyStr(value)}' is not a number`);
  return x;
}

// --- CSV ------------------------------------------------------------------------------

export function parseCsv(text: string): Raw {
  let parsed;
  try {
    parsed = csvDictRows(text);
  } catch (err) {
    if (err instanceof CsvError) throw new RubricError([`CSV could not be read: ${err.message}`]);
    throw err;
  }
  const headers = new Set((parsed.fieldnames ?? []).map((h) => pyStrip(h).toLowerCase()));
  const missing = REQUIRED_CSV.filter((h) => !headers.has(h)).sort();
  if (missing.length) throw new RubricError([`CSV is missing column(s): ${missing.join(", ")}`]);
  const criteria = new Map<string, Record<string, unknown>>();
  for (const dictRow of parsed.rows) {
    const row = new Map<string, string>();
    for (const [k, v] of dictRow) if (k) row.set(pyStrip(k).toLowerCase(), typeof v === "string" ? v : "");
    const name = pyStrip(row.get("criterion")!);
    if (!name) continue;
    if (!criteria.has(name)) criteria.set(name, { title: name, levels: [] });
    const c = criteria.get(name) as Record<string, unknown>;
    for (const [field, target] of [["criterion_description", "description"], ["weight", "weight"], ["max_points", "max_points"]]) {
      if (pyStrip(row.get(field) ?? "")) c[target] = row.get(field);
    }
    (c.levels as Raw[]).push({ label: row.get("level_label"), points: row.get("points"), descriptor: row.get("descriptor") });
  }
  return { criteria: [...criteria.values()] };
}

// --- Grids ----------------------------------------------------------------------------

const NUMBER = `[${DIGIT_CLASS}]+(?:\\.[${DIGIT_CLASS}]+)?`;
const GRID_HEADER = new RegExp(`^[${WS}]*(.+?\\([${WS}]*(${NUMBER})[${WS}]*\\))[${WS}]*$`, "su");
const MARKS_HEADER = new RegExp(`^[${WS}]*(${NUMBER}(?:[${WS}]*[,/;][${WS}]*${NUMBER})*)[${WS}]*(?:\\(.+\\))?[${WS}]*$`, "su");
const MARK = new RegExp(NUMBER, "gu");
/** A weight written at the end of a criterion's name, as a percentage: `Analysis (12.5%)`. */
const WEIGHT_IN_NAME = new RegExp(`^(.*?)[${WS}]*\\([${WS}]*(${NUMBER})[${WS}]*%[${WS}]*\\)[${WS}]*$`, "su");

/** What a level header says: the label it is kept under (as written), the points that stand for the level, and how, if it is more than the one number written. */
interface LevelHeader {
  label: string;
  points: string;
  worth: number;
  marks: string[];
}

/**
 * A layout a grid's level headers can follow. A table is read when every header follows one layout, and says which; a header that follows none is not guessed at.
 * A new layout is a new entry here (and in the Python core), with its examples in the tests.
 */
interface GridLayout {
  name: string; // as the preview says it
  reads: string; // what a header must read, as a problem says it
  example: string;
  /** The header as written (`cell`) and with its spaces collapsed (`text`), or null when it does not follow this layout. */
  read: (cell: string, text: string) => LevelHeader | null;
}

const LAYOUTS: GridLayout[] = [
  {
    name: "Label (points)",
    reads: "'Label (points)'",
    example: "'Excellent (85)'",
    read(cell, text) {
      const m = GRID_HEADER.exec(text);
      return m ? { label: pyStrip(cell), points: m[2], worth: pyFloat(m[2])!, marks: [m[2]] } : null; // validate a normalised copy, but keep the label exactly as written
    },
  },
  {
    name: "marks, then an optional band in brackets",
    reads: "marks, then an optional band in brackets",
    example: "'78, 75, 72 (1st)' or '0'",
    read(cell, text) {
      const m = MARKS_HEADER.exec(text);
      if (!m) return null;
      const marks = m[1].match(MARK)!;
      const sorted = marks.map((x) => pyFloat(x)!).sort((x, y) => x - y);
      const n = sorted.length;
      const worth = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2; // the middle one, or between the two middle ones
      return { label: pyStrip(cell), points: pyReprFloat(worth), worth, marks };
    },
  },
];

/** What a header looks like, without what it says: letters as `a` or `A`, digits as `9`, anything else outside ASCII as `?`, each run as one. */
export function shapeOf(text: string): string {
  const shaped = [...text].map((ch) => (/[A-Z]/.test(ch) ? "A" : /[a-z]/.test(ch) ? "a" : /[0-9]/.test(ch) ? "9" : ch.charCodeAt(0) < 128 ? ch : "?"));
  return shaped.filter((ch, i) => ch !== shaped[i - 1]).join("");
}

const cellText = (cell: string) => pySplit(cell).join(" ");
const layoutsSaid = () => `a table is read when every level header follows one layout: ${LAYOUTS.map((l) => `${l.reads}, for example ${l.example}`).join("; or ")}`;

/** Every layout all the (non-empty) level headers of a table follow. */
function layoutsOf(headers: string[]): GridLayout[] {
  const texts = headers.map(cellText).filter(Boolean);
  return texts.length ? LAYOUTS.filter((l) => texts.every((t) => l.read(t, t))) : [];
}

/** Whether any layout reads all the (non-empty) level headers of a table. */
const readable = (headers: string[]) => layoutsOf(headers).length > 0;

/** What was found when a docx has no table that can be read: how many tables, their sizes, and the shapes of the first row's headers. */
function tablesFound(tables: string[][][]): string {
  if (!tables.length) return "the document has no tables";
  const shown = tables.slice(0, 3).map((rows, i) => {
    const header = (rows[0] ?? []).slice(1).map(cellText).filter(Boolean);
    return `table ${i + 1} is ${rows.length} row${rows.length === 1 ? "" : "s"} by ${rows[0]?.length ?? 0} column${rows[0]?.length === 1 ? "" : "s"}, its level headers (after the first column), by shape: ${header.length ? header.slice(0, 6).map((h) => `'${shapeOf(h)}'`).join(", ") : "none"}`;
  });
  return `the document has ${tables.length} table${tables.length === 1 ? "" : "s"}: ${shown.join("; ")}${tables.length > 3 ? "; and more" : ""}`;
}

/** A weight read from the end of a criterion's name: which criterion (by position among those read), where, and what it said. */
export interface WeightInName {
  index: number;
  row: number;
  title: string;
  weight: number;
  written: string;
}

/** The notes on weights read from names, once any weight entered by hand has been applied: each says where the criterion's weight is from, and what it is. */
function weightNotes(where: string, inNames: WeightInName[], rubric: Rubric): string[] {
  return inNames.map((w) => {
    const effective = rubric.criteria[w.index].weight;
    return effective === w.weight
      ? `${where}: row ${w.row} '${w.title}' is weighted ${pyFormatG(w.weight)}, read from '(${w.written}%)' in its name`
      : `${where}: row ${w.row} '${w.title}' has a weight of ${pyFormatG(w.weight)} in its name, but the weight entered, ${pyFormatG(effective!)}, is used`;
  });
}

/**
 * Criteria down the first column, level headers across the first row, each following one named layout (see LAYOUTS). A criterion's name may end in its weight, as a
 * percentage (`Analysis (12.5%)`), which is read as its weight and taken out of the title.
 * Returns the parsed rubric, any layout problems, and notes on how it was read when that is more than the plain `Label (points)` (which layout, what stands for each level,
 * where each weight came from), so they can be reported together with the rubric's own problems.
 */
export function parseGrid(grid: (string | null)[][], where: string): [Raw, string[], string[], WeightInName[]] {
  const rows = grid.map((r) => r.map((c) => c ?? "")).filter((r) => r.some((c) => pyStrip(c)));
  if (rows.length < 2 || rows[0].length < 2) throw new RubricError([`${where}: expected a grid with criteria rows and level columns`]);
  const problems: string[] = [];
  const notes: string[] = [];
  const cells = rows[0].slice(1);
  const texts = cells.map(cellText);
  // The layout every header follows; failing that, the one most of them follow, and the others are the problems.
  const candidates = layoutsOf(cells);
  const layout = candidates[0] ?? LAYOUTS.map((l) => ({ l, n: texts.filter((t) => t && l.read(t, t)).length })).reduce((best, x) => (x.n > best.n ? x : best)).l;
  // Headers that two layouts read differently are not chosen between by their order in the list: the points of a level are not guessed.
  texts.forEach((text, i) => {
    if (!text) return;
    const readings = candidates.map((l) => ({ l, header: l.read(cells[i], text) }));
    if (readings.length > 1 && readings.some((r) => r.header!.worth !== readings[0].header!.worth))
      problems.push(`${where}: column ${i + 2} header (shape '${shapeOf(text)}') can be read two ways, ${readings.map((r) => `${r.l.reads} makes it worth ${pyFormatG(r.header!.worth)}`).join(", but ")}; change the header so that only one fits`);
  });
  const headers = cells.map((cell, i): LevelHeader | null => {
    const col = i + 2;
    const text = texts[i];
    if (!text) return null;
    const header = layout.read(cell, text);
    if (!header) {
      problems.push(`${where}: column ${col} header (shape '${shapeOf(text)}') does not read ${layout.reads}`);
      return null;
    }
    return header;
  });
  if (problems.length && !candidates.length) problems.push(`${where}: ${layoutsSaid()}. The level headers here, by shape: ${texts.filter(Boolean).map((t) => `'${shapeOf(t)}'`).join(", ")}`);
  else if (!problems.length && layout !== LAYOUTS[0]) {
    notes.push(`${where}: read with the layout '${layout.name}': a level with several marks is worth the middle one`);
    headers.forEach((h, i) => h && notes.push(`${where}: column ${i + 2} '${texts[i]}' is worth ${pyFormatG(h.worth)}${h.marks.length > 1 ? `, the middle of its marks ${h.marks.join(", ")}` : ""}`));
  }
  const criteria: Raw[] = [];
  const inNames: WeightInName[] = [];
  rows.slice(1).forEach((row, i) => {
    const r = i + 2;
    const lines = pySplitlines(row[0]).map(pyStrip).filter(Boolean);
    if (!lines.length) {
      problems.push(`${where}: row ${r} has no criterion title`);
      return;
    }
    const levels: Raw[] = [];
    headers.forEach((header, j) => {
      const col = j + 2;
      const descriptor = col - 1 < row.length ? row[col - 1] : "";
      if (header === null) {
        if (pyStrip(descriptor)) problems.push(`${where}: row ${r} column ${col} has text under no valid header`);
        return;
      }
      levels.push({ label: header.label, points: header.points, descriptor });
    });
    const criterion: Record<string, unknown> = { title: lines[0], description: lines.slice(1).join("\n"), levels };
    const named = WEIGHT_IN_NAME.exec(lines[0]);
    if (named && pyStrip(named[1])) {
      criterion.title = pyStrip(named[1]);
      criterion.weight = named[2];
      inNames.push({ index: criteria.length, row: r, title: pyStrip(named[1]), weight: pyFloat(named[2])!, written: named[2] });
    }
    criteria.push(criterion);
  });
  return [{ criteria }, problems, notes, inNames];
}

const kindOf = (err: unknown) => (err as object).constructor.name;
const isReadError = (err: unknown) => err instanceof XlsxError || err instanceof DocxError || err instanceof XmlError || err instanceof ZipError;

async function readXlsxGrid(bytes: Uint8Array, sheet: string | null): Promise<(string | null)[][]> {
  try {
    return await readXlsxRows(bytes, sheet);
  } catch (err) {
    if (err instanceof XlsxNoSheet) throw new RubricError([`xlsx has no sheet '${sheet}'`]);
    if (isReadError(err)) throw new RubricError([`xlsx could not be read: ${(err as Error).message}`]);
    throw err;
  }
}

async function readDocxGrid(bytes: Uint8Array): Promise<string[][]> {
  let tables: string[][][];
  try {
    tables = (await readDocxTables(bytes)).map((table) => table());
  } catch (err) {
    if (isReadError(err)) throw new RubricError([`docx could not be read (${kindOf(err)})`]);
    throw err;
  }
  for (const rows of tables) {
    if (rows.length && readable(rows[0].slice(1))) return rows;
  }
  throw new RubricError([
    `no rubric grid table found (criteria down the first column, level headers across the first row; ${layoutsSaid()}); ${tablesFound(tables)}; ` +
      "export the rubric as xlsx or csv instead",
  ]);
}

// --- JSON -----------------------------------------------------------------------------

/** Reject JSON that is not the documented shape before it is used. */
export function raiseForJsonShape(raw: unknown): asserts raw is Raw {
  if (!isDict(raw)) throw new RubricError(["JSON rubric must be an object with a 'criteria' list"]);
  const problems: string[] = [];
  const criteria = get(raw, "criteria");
  if (!Array.isArray(criteria)) problems.push("JSON rubric must have a 'criteria' list");
  else {
    criteria.forEach((c, i) => {
      if (!isDict(c)) problems.push(`criterion ${i + 1} must be an object`);
      else {
        const levels = get(c, "levels");
        if (!Array.isArray(levels) || !levels.every(isDict)) problems.push(`criterion ${i + 1} must have a 'levels' list of objects`);
      }
    });
  }
  if (problems.length) throw new RubricError(problems);
}

// --- Building -------------------------------------------------------------------------

export interface BuildOptions {
  title: string;
  version: string;
  sourceHash: string;
  weights?: Map<string, number> | Record<string, number>;
  actor?: Actor; // who imported it; the moderator unless given
  now?: Date;
  /** Where it came from and how: a file the moderator imported, unless it was entered from an image. */
  provenance?: { source: string; transformation: "imported" | "entered" };
  /** Keep a literal backslash-n as written, as a rubric typed in directly may mean it; an imported file's are line breaks (a spreadsheet export's artefact). */
  keepEscapes?: boolean;
}

/**
 * pydantic's messages for the number rules Python's models check. Python
 * accepts infinity here (and then writes it as null); this core refuses it.
 */
function numberProblem(value: number | null, rule: "gt0" | "ge0"): string | null {
  if (value === null) return null;
  if (value === Infinity || value === -Infinity) return "Input should be a finite number";
  if (rule === "gt0" && !(value > 0)) return "Input should be greater than 0";
  if (rule === "ge0" && !(value >= 0)) return "Input should be greater than or equal to 0";
  return null;
}

export function buildRubric(raw: Raw, options: BuildOptions): [Rubric, string[]] {
  const weights = new Map(options.weights instanceof Map ? options.weights : Object.entries(options.weights ?? {}));
  const problems: string[] = [];
  const warnings: string[] = [];
  const criteria: Criterion[] = [];
  const seenIds = new Set<string>();
  const rawCriteria = get(raw, "criteria");
  (pyTruthy(rawCriteria) ? (rawCriteria as Raw[]) : []).forEach((c, index) => {
    const ci = index + 1;
    const title = pyStrip(pyStr(get(c, "title", "")));
    const where = `criterion ${ci} ('${title || "?"}')`;
    if (!title) {
      problems.push(`criterion ${ci}: title is empty`);
      return;
    }
    let cid = slug(title);
    for (let n = 2, base = cid; seenIds.has(cid); n++) cid = `${base}-${n}`;
    seenIds.add(cid);
    const levels: Level[] = [];
    const levelIds = new Set<string>();
    const rawLevels = get(c, "levels");
    (pyTruthy(rawLevels) ? (rawLevels as Raw[]) : []).forEach((lv, li0) => {
      const li = li0 + 1;
      const lwhere = `${where} level ${li}`;
      const label = pyStr(get(lv, "label", "")); // kept exactly as written
      const points = number(get(lv, "points"), lwhere, problems);
      const descriptor = clean(pyStr(get(lv, "descriptor", "")), lwhere, warnings, options.keepEscapes);
      if (!pyStrip(label)) problems.push(`${lwhere}: label is empty`);
      if (!descriptor) problems.push(`${lwhere}: descriptor is empty`);
      let lid = points !== null ? `p${pyFormatG(points)}`.replaceAll(".", "-") : `l${li}`;
      for (let m = 2, base = lid; levelIds.has(lid); m++) lid = `${base}-${m}`;
      levelIds.add(lid);
      if (pyStrip(label) && descriptor) {
        // Python fails with an unhandled validation error here; this core lists the problem.
        const pointsProblem = numberProblem(points, "ge0");
        const level = Level.safeParse({ id: lid, label, descriptor, points });
        if (pointsProblem) problems.push(`${lwhere}: ${pointsProblem}`);
        else if (!level.success) problems.push(`${lwhere}: level id '${lid}' is not a valid identifier`);
        else levels.push(level.data);
      }
    });
    if (!levels.length) {
      problems.push(`${where}: no valid levels`);
      return;
    }
    // In Python's keyword-argument order: description, weight, max_points.
    const description = clean(pyStr(get(c, "description", "")), where, warnings, options.keepEscapes);
    let weight: number | null;
    if (weights.has(cid)) {
      weight = weights.get(cid)!; // an explicit override wins even when it is 0, so it is validated
      weights.delete(cid);
    } else weight = number(get(c, "weight"), `${where} weight`, problems);
    const maxPoints = number(get(c, "max_points"), `${where} max_points`, problems);
    const invalid = [numberProblem(weight, "gt0"), numberProblem(maxPoints, "gt0")].filter((p) => p !== null);
    if (invalid.length) {
      problems.push(...invalid.map((p) => `${where}: ${p}`));
      return;
    }
    criteria.push(Criterion.parse({ id: cid, title, description, weight, max_points: maxPoints, levels }));
  });
  if (!criteria.length && !problems.length) problems.push("the rubric has no criteria");
  for (const unknown of weights.keys()) problems.push(`weight given for unknown criterion '${unknown}'`);
  if (problems.length) throw new RubricError(problems);
  const timestamp = (options.now ?? new Date()).toISOString();
  const rubric = Rubric.safeParse({
    id: slug(options.title),
    version: options.version,
    title: options.title,
    criteria,
    provenance: {
      source: options.provenance?.source ?? `file:sha256:${options.sourceHash}`,
      transformation: options.provenance?.transformation ?? "imported",
      actor: options.actor ?? MODERATOR,
      timestamp,
      input_hashes: [options.sourceHash],
    },
  });
  if (!rubric.success) throw new RubricError(rubric.error.issues.map((i) => `${i.path.join(".") || "rubric"}: ${i.message}`));
  return [rubric.data, warnings];
}

// --- Importing ------------------------------------------------------------------------

/** Python's `PurePath(name).suffix` and `.stem` (3.14: a trailing dot is a suffix; leading dots are not). */
export function suffixAndStem(fileName: string): [string, string] {
  const name = fileName.slice(fileName.lastIndexOf("/") + 1);
  const i = name.lastIndexOf(".");
  if (i > 0 && /[^.]/.test(name.slice(0, i))) return [name.slice(i), name.slice(0, i)];
  return ["", name];
}

export interface ImportRubricOptions {
  title?: string | null;
  version?: string;
  weights?: Map<string, number> | Record<string, number>;
  sheet?: string | null;
  confirm?: boolean;
  replace?: boolean;
  now?: Date;
}

export interface ImportedRubric {
  rubric: Rubric;
  warnings: string[];
  written: boolean;
}

function decodeText(bytes: Uint8Array, kind: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes); // removes one leading BOM, as utf-8-sig does
  } catch {
    throw new RubricError([`${kind} could not be read: it is not UTF-8 text`]);
  }
}

/**
 * Parse and store a rubric.
 *
 * CSV and JSON are written directly. Grid formats (xlsx, docx) are
 * best-effort, so they are written only when `confirm` is true; otherwise
 * the parsed rubric is returned for the moderator to check.
 */
export async function importRubric(ws: Workspace, source: ByteSource, options: ImportRubricOptions = {}): Promise<ImportedRubric> {
  if ((await ws.exists(RUBRIC)) && !options.replace) {
    throw new WorkspaceError("a rubric is already imported; use replace to import again");
  }
  let layoutProblems: string[] = [];
  let notes: string[] = [];
  let inNames: WeightInName[] = [];
  const data = await source.read(0, source.size);
  const [rawSuffix, stem] = suffixAndStem(source.name);
  const suffix = rawSuffix.toLowerCase();
  let raw: Raw;
  if (suffix === ".csv") raw = parseCsv(decodeText(data, "CSV"));
  else if (suffix === ".json") {
    let parsed: unknown;
    try {
      parsed = parsePyJson(decodeText(data, "JSON"));
    } catch (err) {
      if (err instanceof SyntaxError) throw new RubricError([`JSON could not be parsed: ${err.message}`]);
      throw err;
    }
    raiseForJsonShape(parsed);
    raw = parsed;
  } else if (suffix === ".xlsx") [raw, layoutProblems, notes, inNames] = parseGrid(await readXlsxGrid(data, options.sheet ?? null), "xlsx");
  else if (suffix === ".docx") [raw, layoutProblems, notes, inNames] = parseGrid(await readDocxGrid(data), "docx table");
  else throw new RubricError([`unsupported rubric file type '${suffix}'; use .csv, .json, .xlsx, or .docx`]);

  let built: [Rubric, string[]];
  try {
    const rawTitle = get(raw, "title");
    built = buildRubric(raw, {
      title: options.title || (pyTruthy(rawTitle) ? pyStr(rawTitle) : stem),
      version: options.version ?? "1",
      sourceHash: sha256Bytes(data),
      weights: options.weights,
      now: options.now,
      actor: ownerOf(ws),
    });
  } catch (err) {
    if (err instanceof RubricError) throw new RubricError([...layoutProblems, ...err.problems]);
    throw err;
  }
  if (layoutProblems.length) throw new RubricError(layoutProblems);
  const [rubric, builtWarnings] = built;
  const warnings = [...notes, ...weightNotes(suffix === ".xlsx" ? "xlsx" : "docx table", inNames, rubric), ...builtWarnings];
  if (GRID_FORMATS.has(suffix) && !options.confirm) return { rubric, warnings, written: false };
  // Two files, each written atomically. If the rubric can't be written, the
  // previous warnings are put back, so the pair on disk always belongs together.
  const previousWarnings = await ws.fs.readText(RUBRIC_WARNINGS);
  const previousProposal = await ws.fs.readText(RUBRIC_PROPOSAL);
  try {
    await ws.writeJson(RUBRIC_WARNINGS, warnings);
    await ws.writeJson(RUBRIC, rubric);
    // A rubric imported from a file didn't begin as an AI proposal, whatever the one it replaces did.
    if (previousProposal !== null) await ws.fs.remove(RUBRIC_PROPOSAL);
  } catch (err) {
    await (previousWarnings !== null ? ws.fs.writeText(RUBRIC_WARNINGS, previousWarnings) : ws.fs.remove(RUBRIC_WARNINGS)).catch(() => {});
    if (previousProposal !== null) await ws.fs.writeText(RUBRIC_PROPOSAL, previousProposal).catch(() => {});
    throw err;
  }
  return { rubric, warnings, written: true };
}
