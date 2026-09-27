/**
 * Reading the setup forms, in the same shapes the Python command line takes
 * (core/src/feedbacker_core/cli.py), one per line: the sample as
 * `BAND:ID,ID` or `ID,ID` (split at the last colon, so a band such as "2:1"
 * works), bands as `LABEL=COUNT`, and rubric weights as `CRITERION_ID=PERCENT`.
 * Every problem is reported, with its line.
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

/** `BAND:ID,ID` or `ID,ID` per line. Identifiers are checked by the core when the request is recorded. */
export function parseSample(text: string): SampleEntry[] {
  return lines(text).flatMap((line) => {
    const at = line.lastIndexOf(":");
    const band = at < 0 ? "" : line.slice(0, at).trim();
    const ids = at < 0 ? line : line.slice(at + 1);
    return ids.split(",").map((external_id) => ({ external_id, band: band || null }));
  });
}

/** `LABEL=COUNT` per line. */
export function parseBands(text: string): BandCount[] {
  const problems: string[] = [];
  const bands = lines(text).flatMap((line) => {
    const at = line.lastIndexOf("=");
    const label = at < 0 ? "" : line.slice(0, at).trim();
    const count = at < 0 ? "" : line.slice(at + 1).trim();
    if (!label || !/^\d+$/.test(count)) {
      problems.push(`band '${line}' must look like LABEL=COUNT, e.g. 60-69=2`);
      return [];
    }
    return [{ label, count: Number(count) }];
  });
  if (problems.length) throw new FormProblem(problems);
  return bands;
}

/** `CRITERION_ID=PERCENT` per line (a trailing % is allowed). */
export function parseWeights(text: string): Map<string, number> {
  const problems: string[] = [];
  const weights = new Map<string, number>();
  for (const line of lines(text)) {
    const at = line.lastIndexOf("=");
    const id = at < 0 ? "" : line.slice(0, at).trim();
    // Python's float(), as the command line reads it: not "0x10" or "0b10", which JavaScript's Number accepts.
    const n = at < 0 ? null : pyFloat(line.slice(at + 1).trim().replace(/%+$/, ""));
    if (!id || n === null) problems.push(`weight '${line}' must look like CRITERION_ID=PERCENT`);
    else weights.set(id, n);
  }
  if (problems.length) throw new FormProblem(problems);
  return weights;
}

/**
 * `KEY=VALUE` per line, as the command line's `parse_pairs` reads them (split
 * at the last "="; both sides needed), e.g. `PROFESSIONALISM=reflection` to
 * map a marker's criterion.
 */
export function parsePairs(text: string, form: string): Map<string, string> {
  const problems: string[] = [];
  const pairs = new Map<string, string>();
  for (const line of lines(text)) {
    const at = line.lastIndexOf("=");
    const key = at < 0 ? "" : line.slice(0, at).trim();
    const value = at < 0 ? "" : line.slice(at + 1).trim();
    if (!key || !value) problems.push(`'${line}' must look like ${form}`);
    else pairs.set(key, value);
  }
  if (problems.length) throw new FormProblem(problems);
  return pairs;
}

/** `SOURCE_ID=POINTS` per line, the points read with Python's float(), as the command line does. */
export function parsePoints(text: string): Map<string, number> {
  const problems: string[] = [];
  const points = new Map<string, number>();
  for (const [key, value] of parsePairs(text, "SOURCE_ID=POINTS")) {
    const n = pyFloat(value);
    if (n === null) problems.push(`points for '${key}' must be a number, not '${value}'`);
    else points.set(key, n);
  }
  if (problems.length) throw new FormProblem(problems);
  return points;
}

/** A mark (Python's float()), or null when left empty. */
export function parseMark(text: string, what: string): number | null {
  if (!text.trim()) return null;
  const n = pyFloat(text);
  if (n === null) throw new FormProblem([`${what} must be a number, not '${text.trim()}'`]);
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
  sample: string;
  programme: string;
  module: string;
  roles: string;
  cohort: string;
  groups: "unknown" | "single" | "multiple";
  bands: string;
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
  const sample = parseSample(fields.sample);
  const cohort = attempt(() => parseCount(fields.cohort, "the cohort size"), null);
  const bands = attempt(() => parseBands(fields.bands), []);
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
  if (Array.isArray(problems) && problems.every((p) => typeof p === "string")) return problems;
  return [err instanceof Error ? err.message : String(err)];
}
