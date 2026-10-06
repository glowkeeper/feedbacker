/**
 * Reading the setup forms. Lists are entered row by row, and values per
 * criterion in a box each, never as KEY=VALUE text: the sample as a band
 * (optional) and its submission IDs, the band distribution as a band and a
 * number of students, rubric weights and marks as a number per criterion.
 * Numbers are read with Python's float(), as the command line reads them.
 * Every problem is reported together, naming what it is about.
 */

import type { BandCount, RequestOptions, SampleEntry } from "../core/index.ts";
import { pyFloat } from "../core/pytext.ts";

export class FormProblem extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(problems.join("; "));
    this.name = "FormProblem";
    this.problems = problems;
  }
}

const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

export interface SampleRow {
  band: string;
  ids: string; // separated by commas, spaces or new lines
}

/** The sample, a row per band; a row with no band is a sample without one. Identifiers are checked by the core when the request is recorded. */
export function sampleFrom(rows: SampleRow[]): SampleEntry[] {
  const problems: string[] = [];
  const sample = rows.flatMap((row) => {
    const band = row.band.trim();
    const ids = row.ids.split(/[\s,]+/).filter(Boolean);
    if (band && !ids.length) problems.push(`the band '${band}' has no submission IDs`);
    return ids.map((external_id) => ({ external_id, band: band || null }));
  });
  if (problems.length) throw new FormProblem(problems);
  return sample;
}

export interface BandRow {
  label: string;
  count: string;
}

/** The cohort's band distribution, a row per band; an empty row is ignored. */
export function bandsFrom(rows: BandRow[]): BandCount[] {
  const problems: string[] = [];
  const bands = rows.flatMap(({ label: rawLabel, count: rawCount }) => {
    const label = rawLabel.trim();
    const count = rawCount.trim();
    if (!label && !count) return [];
    if (!label) problems.push(`the number of students ${count} needs its band`);
    else if (!/^\d+$/.test(count)) problems.push(`the band '${label}' needs a whole number of students${count ? `, not '${count}'` : ""}`);
    else return [{ label, count: Number(count) }];
    return [];
  });
  if (problems.length) throw new FormProblem(problems);
  return bands;
}

/** A number per criterion, from its box (empty boxes are left out); `what` names it in a problem, e.g. "the weight". */
function perCriterion(values: Record<string, string>, titles: Map<string, string>, what: string, strip = (v: string) => v): Map<string, number> {
  const problems: string[] = [];
  const out = new Map<string, number>();
  for (const [id, raw] of Object.entries(values)) {
    const value = raw.trim();
    if (!value) continue;
    // Python's float(): not "0x10" or "0b10", which JavaScript's Number accepts; and finite, since JSON can't store inf or nan.
    const n = pyFloat(strip(value));
    if (n === null || !Number.isFinite(n)) problems.push(`${what} for ${titles.get(id) ?? id} must be a number, not '${value}'`);
    else out.set(id, n);
  }
  if (problems.length) throw new FormProblem(problems);
  return out;
}

/** Rubric weights, a percentage per criterion (a trailing % is allowed); an empty box keeps the file's weight. */
export const weightsFrom = (values: Record<string, string>, titles: Map<string, string>) => perCriterion(values, titles, "the weight", (v) => v.replace(/\s*%+$/, ""));

/** The weights entered so far, added up, or null while any box isn't a number that could be saved (so never inf or nan). */
export function totalWeight(values: Record<string, string>): number | null {
  const numbers = Object.values(values)
    .map((v) => v.trim().replace(/\s*%+$/, ""))
    .filter(Boolean)
    .map(pyFloat);
  return numbers.some((n) => n === null || !Number.isFinite(n)) ? null : (numbers as number[]).reduce((a, b) => a + b, 0);
}

/** Marks entered by hand, one per criterion; an empty box is no mark. */
export const pointsFrom = (values: Record<string, string>, titles: Map<string, string>) => perCriterion(values, titles, "the mark");

/** A mark (Python's float(), but finite, so it can be stored), or null when left empty. */
export function parseMark(text: string, what: string): number | null {
  if (!text.trim()) return null;
  const n = pyFloat(text);
  if (n === null || !Number.isFinite(n)) throw new FormProblem([`${what} must be a number, not '${text.trim()}'`]);
  return n;
}

/** One entry per line, e.g. staff roles. */
export const parseList = (text: string) => lines(text);

/** A whole number of at least 1, or null when left empty. */
export function parseCount(text: string, what: string): number | null {
  const value = text.trim();
  if (!value) return null;
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new FormProblem([`${what} must be a whole number of at least 1`]);
  return Number(value);
}

export interface RequestFields {
  sample: SampleRow[];
  programme: string;
  module: string;
  roles: string;
  cohort: string;
  groups: "unknown" | "single" | "multiple";
  bands: BandRow[];
  note: string;
}

/**
 * The request form, read field by field so that every problem is reported
 * together; the core then checks the sample and the counts, and reports its
 * own problems together too.
 */
export function parseRequestForm(fields: RequestFields): { sample: SampleEntry[]; options: RequestOptions } {
  const problems: string[] = [];
  const attempt = <T>(read: () => T, fallback: T): T => {
    try {
      return read();
    } catch (err) {
      problems.push(...problemsOf(err));
      return fallback;
    }
  };
  const sample = attempt(() => sampleFrom(fields.sample), []);
  const cohort = attempt(() => parseCount(fields.cohort, "the cohort size"), null);
  const bands = attempt(() => bandsFrom(fields.bands), []);
  if (problems.length) throw new FormProblem(problems);
  return {
    sample,
    options: {
      programme: fields.programme,
      module: fields.module,
      staff_roles: parseList(fields.roles),
      cohort_size: cohort,
      multiple_groups: fields.groups === "unknown" ? null : fields.groups === "multiple",
      band_distribution: bands,
      sample_note: fields.note,
    },
  };
}

/** The problems in an error from the core or the forms: its list, or its message. */
export function problemsOf(err: unknown): string[] {
  const problems = (err as { problems?: unknown }).problems;
  if (Array.isArray(problems) && problems.every((p) => typeof p === "string")) return problems.map(inApp);
  // Never a blank problem: an error without a message (some of the browser's own) is named by its kind instead.
  const message = err instanceof Error ? err.message || `${err.name || "an unexpected error"} (no further detail)` : String(err) || "an unexpected error";
  return [inApp(message)];
}

/**
 * A core message in the app's terms. The core's messages match the Python
 * command line's, and some name its commands and options; the app names its
 * own screens instead.
 */
export function inApp(message: string): string {
  return message
    .replace(" ('rubric import')", " (Rubric)")
    .replace("see 'rubric import' preview", "the source rubric's IDs are on the Rubric screen")
    .replace("map it with --criterion", "match it under \"Match the marker's criteria\" and import again")
    .replace("import and approve it ('brief import'), or run with --no-brief to read without one", 'import it (Brief) and approve it (Anonymisation), or untick "Include the approved brief" to read without one')
    .replace("approve it ('anonymise approve WORKSPACE brief') before reading", "review and approve it under Anonymisation before reading");
}
