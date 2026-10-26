/**
 * Read a moderation request document (docx): the module's context and the
 * cohort it lists, for the moderator to check before anything is recorded.
 *
 * Request documents differ between institutions, so nothing here depends on
 * one layout. The cohort is the first table whose header row has a student ID
 * column and a mark column (found by what the headers say, not by position).
 * The context comes from rows of two columns, a label and its value, found by
 * what the label says. Anything uncertain is flagged and left empty, never
 * guessed. Staff names (a convener, a marker) are in rows this never reads, and
 * nothing is kept of the document itself: the findings are returned and the
 * caller decides what to record.
 *
 * Flags describe a problem by its row or kind, never by a student's name or
 * ID, so they are safe to show or log.
 */

import { readDocxTables } from "./docx.ts";
import { isExternalId } from "./request.ts";
import type { BandCount } from "./models.ts";

export class RequestDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestDocumentError";
  }
}

/** One student's row of the cohort table. */
export interface CohortRow {
  /** The assessment as written (for example "Report (60%)"); empty when the table doesn't say. */
  assessment: string;
  title: string;
  /** The weighting written in the assessment text, as a percentage. */
  weight: number | null;
  /** The institution's own student ID, and the student's name as written: for the private pseudonym key only. */
  student_id: string;
  name: string;
  initial: number | null;
  agreed: number | null;
  /** False where the table says the student submitted nothing (for example NS). */
  submitted: boolean;
  /** Problems with this row, never quoting it. */
  flags: string[];
}

/** A grade band, read from its label ("70+", "60-69"), with how many students the document puts in it. */
export interface BandFinding {
  label: string;
  /** From this mark up to this mark (null: no upper limit). */
  from: number;
  to: number | null;
  /** The count, or null where the row gave none or more than one (so it can't be told which is meant). */
  count: number | null;
}

export interface RequestFindings {
  programme: string | null;
  module: string | null;
  cohort_size: number | null;
  multiple_groups: boolean | null;
  bands: BandFinding[];
  cohort: CohortRow[];
  /** Problems with the document as a whole, never quoting it. */
  flags: string[];
}

const squash = (text: string) => text.split(/\s+/).filter(Boolean).join(" ");

// --- The cohort table -------------------------------------------------------------------

const ID_HEADER = /student\s*(id|number|no\b)/i;
const NAME_HEADER = /\bname\b/i;
const ASSESSMENT_HEADER = /assessment/i;
const MARK_HEADER = /mark/i;
const INITIAL_QUALIFIER = /initial|first|original/i;
const AGREED_QUALIFIER = /agreed|moderated|final|second/i;
const NO_SUBMISSION = /^(ns|n\/s|nil|no submission|non[- ]?submission|not submitted|absent|dnf|n\/a)$/i;
const ASSESSMENT_WEIGHT = /^(.*?)\s*\(\s*(\d{1,3}(?:\.\d+)?)\s*%\s*\)\s*$/;

interface Columns {
  id: number;
  name: number | null;
  assessment: number | null;
  initial: number;
  agreed: number | null;
}

/** Which column is which, from a header row; null when it isn't one (it needs a student ID column and a mark column). */
function columnsOf(row: string[]): Columns | null {
  const cells = row.map(squash);
  const id = cells.findIndex((c) => ID_HEADER.test(c));
  if (id < 0) return null;
  const name = cells.findIndex((c, i) => i !== id && NAME_HEADER.test(c) && !MARK_HEADER.test(c));
  const assessment = cells.findIndex((c) => ASSESSMENT_HEADER.test(c) && !MARK_HEADER.test(c));
  const marks = cells.flatMap((c, i) => (MARK_HEADER.test(c) && i !== id ? [i] : []));
  const agreed = marks.find((i) => AGREED_QUALIFIER.test(cells[i]));
  const initial = marks.find((i) => INITIAL_QUALIFIER.test(cells[i]) && i !== agreed) ?? marks.find((i) => i !== agreed);
  if (initial === undefined) return null;
  return { id, name: name < 0 ? null : name, assessment: assessment < 0 ? null : assessment, initial, agreed: agreed ?? null };
}

/** A mark as a number whether or not it has a percent sign; "no submission" for NS and the like; flagged for anything else. */
function markOf(text: string, what: string, flags: string[]): { mark: number | null; submitted: boolean } {
  const t = squash(text);
  if (!t) return { mark: null, submitted: true };
  if (NO_SUBMISSION.test(t)) return { mark: null, submitted: false };
  const m = /^(\d{1,3}(?:\.\d+)?)\s*%?$/.exec(t);
  if (m && Number(m[1]) <= 100) return { mark: Number(m[1]), submitted: true };
  flags.push(`${what} couldn't be read as a mark`);
  return { mark: null, submitted: true };
}

function cohortFrom(rows: string[][], flags: string[]): CohortRow[] {
  const out: CohortRow[] = [];
  const seen = new Set<string>();
  let columns: Columns | null = null;
  rows.forEach((row, index) => {
    const header = columnsOf(row);
    if (header) {
      columns = header; // the header row, and again where a table repeats it on a new page
      return;
    }
    if (!columns) return;
    const cell = (i: number | null) => (i === null ? "" : squash(row[i] ?? ""));
    const studentId = cell(columns.id);
    if (!studentId) return; // a blank row left for adding students
    const rowFlags: string[] = [];
    if (!isExternalId(studentId)) rowFlags.push("its student ID isn't of a form Feedbacker can record (letters, digits, '.', '_' or '-')");
    const assessment = cell(columns.assessment);
    const weighted = ASSESSMENT_WEIGHT.exec(assessment);
    const initial = markOf(cell(columns.initial), "its initial mark", rowFlags);
    const agreed = columns.agreed === null ? { mark: null, submitted: true } : markOf(cell(columns.agreed), "its agreed mark", rowFlags);
    const name = cell(columns.name);
    if (columns.name !== null && !name) rowFlags.push("it has no name");
    if (initial.mark === null && initial.submitted) rowFlags.push("it has no initial mark");
    const key = `${assessment}\u0000${studentId}`;
    if (seen.has(key)) {
      flags.push(`row ${index + 1} of the table lists a student already listed for the same assessment; it was left out`);
      return;
    }
    seen.add(key);
    out.push({
      assessment,
      title: weighted ? weighted[1] : assessment,
      weight: weighted ? Number(weighted[2]) : null,
      student_id: studentId,
      name,
      initial: initial.mark,
      agreed: agreed.mark,
      submitted: initial.submitted,
      flags: rowFlags,
    });
  });
  return out;
}

// --- The context ------------------------------------------------------------------------

const BAND_UP = /^(\d{1,3})\s*\+\s*:?\s*((?:\d+\s*)*)$/;
const BAND_RANGE = /^(\d{1,3})\s*[-–]\s*(\d{1,3})\s*:?\s*((?:\d+\s*)*)$/;

function bandOf(text: string): BandFinding | null {
  const t = squash(text);
  let m = BAND_UP.exec(t);
  const counts = (rest: string) => rest.split(/\s+/).filter(Boolean).map(Number);
  if (m) {
    const c = counts(m[2]);
    return { label: `${Number(m[1])}+`, from: Number(m[1]), to: null, count: c.length === 1 ? c[0] : null };
  }
  m = BAND_RANGE.exec(t);
  if (m) {
    const c = counts(m[3]);
    return { label: `${Number(m[1])}-${Number(m[2])}`, from: Number(m[1]), to: Number(m[2]), count: c.length === 1 ? c[0] : null };
  }
  return null;
}

/** The band a mark falls in (a mark of 69.5 is in 60-69), or null if none of the bands holds it. */
export function bandFor(mark: number, bands: BandFinding[]): string | null {
  return bands.find((b) => mark >= b.from && (b.to === null || mark < b.to + 1))?.label ?? null;
}

const PROGRAMME = /programme/i;
const MODULE = /module\s*(title|name)/i;
const COHORT_SIZE = /total\s*number\s*of\s*students/i;
const GROUPS = /multiple\s*(classes|groups)/i;

function contextFrom(tables: string[][][], flags: string[]): Pick<RequestFindings, "programme" | "module" | "cohort_size" | "multiple_groups" | "bands"> {
  const labelled = (rows: string[][]) =>
    rows.filter((r) => r.length >= 2).map((r) => ({ label: squash(r[0]), value: squash([...new Set(r.slice(1).map(squash))].join(" ")), row: r }));
  // The table that gives the cohort's size is the one that describes the module; failing that, the first with a module or programme.
  const table =
    tables.find((rows) => labelled(rows).some((r) => COHORT_SIZE.test(r.label))) ??
    tables.find((rows) => labelled(rows).some((r) => MODULE.test(r.label) || PROGRAMME.test(r.label)));
  const out = { programme: null as string | null, module: null as string | null, cohort_size: null as number | null, multiple_groups: null as boolean | null, bands: [] as BandFinding[] };
  if (!table) {
    flags.push("no module context (programme, module, cohort size) was found");
    return out;
  }
  const rows = labelled(table);
  const value = (pattern: RegExp) => rows.find((r) => pattern.test(r.label))?.value || null;
  out.programme = value(PROGRAMME);
  out.module = value(MODULE);
  const size = value(COHORT_SIZE);
  if (size !== null) {
    const m = /\d+/.exec(size);
    if (m) out.cohort_size = Number(m[0]);
    else flags.push("the cohort size couldn't be read as a number");
  }
  const groups = value(GROUPS);
  if (groups !== null) {
    if (/^(no|n\/a|none|single|one)\b/i.test(groups) || /^1$/.test(groups)) out.multiple_groups = false;
    else if (/^yes\b/i.test(groups) || /\b([2-9]|\d{2,})\b/.test(groups)) out.multiple_groups = true;
    else flags.push("whether the module was marked in groups couldn't be told");
  }
  // Band rows follow the label of the band distribution: their first cell is the label or a repeat of it, and the band is in the value.
  for (const r of rows) {
    const band = bandOf(r.value);
    if (band) out.bands.push(band);
  }
  if (out.bands.some((b) => b.count === null)) flags.push("a band's count is missing or gives more than one number (one per assessment?), so the band distribution wasn't filled in");
  return out;
}

// --- Reading ----------------------------------------------------------------------------

/** Read a request (docx only: a pdf's table can't be told from its text reliably). */
export async function readRequestDocument(fileName: string, bytes: Uint8Array): Promise<RequestFindings> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) throw new RequestDocumentError("a pdf request can't be read yet; choose the Word (docx) version, or enter the request below");
  if (!lower.endsWith(".docx")) throw new RequestDocumentError("only a Word (docx) request document can be read");
  let tables: string[][][];
  try {
    tables = (await readDocxTables(bytes)).map((rows) => rows());
  } catch (err) {
    throw new RequestDocumentError(`the request document couldn't be read (${(err as Error).name}); it may be damaged`);
  }
  const flags: string[] = [];
  const cohort = tables.flatMap((rows) => cohortFrom(rows, flags));
  if (!cohort.length) flags.push("no table of students with a student ID column and a mark column was found");
  const context = contextFrom(tables, flags);
  const bands = context.bands.filter((b, i, all) => all.findIndex((o) => o.label === b.label) === i);
  const countsBy = new Map<string, number>();
  for (const row of cohort) countsBy.set(row.assessment, (countsBy.get(row.assessment) ?? 0) + 1);
  for (const [assessment, n] of countsBy) {
    if (context.cohort_size !== null && n !== context.cohort_size) {
      flags.push(`the table lists ${n} students${assessment ? ` for '${assessment}'` : ""}, but the document gives a cohort size of ${context.cohort_size}`);
    }
  }
  return { ...context, bands, cohort, flags };
}

/** The cohort size and band distribution as the request records them, where the document gave them whole. */
export function bandDistributionOf(findings: RequestFindings): BandCount[] {
  return findings.bands.every((b) => b.count !== null) ? findings.bands.map((b) => ({ label: b.label, count: b.count! })) : [];
}
