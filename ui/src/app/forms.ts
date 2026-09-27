/**
 * Reading the setup forms, in the same shapes the Python command line takes
 * (core/src/feedbacker_core/cli.py), one per line: the sample as
 * `BAND:ID,ID` or `ID,ID` (split at the last colon, so a band such as "2:1"
 * works), bands as `LABEL=COUNT`, and rubric weights as `CRITERION_ID=PERCENT`.
 * Every problem is reported, with its line.
 */

import type { BandCount, SampleEntry } from "../core/index.ts";

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
    const value = at < 0 ? "" : line.slice(at + 1).trim().replace(/%+$/, "");
    const n = Number(value);
    if (!id || value === "" || !Number.isFinite(n)) problems.push(`weight '${line}' must look like CRITERION_ID=PERCENT`);
    else weights.set(id, n);
  }
  if (problems.length) throw new FormProblem(problems);
  return weights;
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

/** The problems in an error from the core or the forms: its list, or its message. */
export function problemsOf(err: unknown): string[] {
  const problems = (err as { problems?: unknown }).problems;
  if (Array.isArray(problems) && problems.every((p) => typeof p === "string")) return problems;
  return [err instanceof Error ? err.message : String(err)];
}
