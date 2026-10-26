/**
 * The cohort a request document listed, as the Overview shows it: for each assessment, who submitted, the grade bands with how many
 * of the cohort and the sample are in each, and its rows by number. Rows carry no name or ID (the stored cohort has none), so the
 * view says nothing of who anyone is; a sampled row says which submission it became.
 */

import { bandOfMark, loadRequest, loadRequestCohort, REQUEST, type RequestCohort, type Workspace } from "../core/index.ts";

export interface CohortBandView {
  label: string;
  cohort: number;
  sample: number;
  /** The count the request itself gives for the band, where it gave one. */
  stated: number | null;
}

export interface CohortRowView {
  row: number;
  initial: string;
  agreed: string;
  band: string;
  /** The submission a sampled row became, or null. */
  sampled: string | null;
}

export interface CohortAssessmentView {
  name: string;
  students: number;
  submitted: number;
  noSubmission: number;
  bands: CohortBandView[];
  /** Students with a mark that is in none of the bands (or no band labels were read). */
  unbanded: number;
  rows: CohortRowView[];
  /** How many of those who submitted are in the sample, for the assessment the moderation is of. */
  inSample: number;
  notes: string[];
}

export interface CohortView {
  assessments: CohortAssessmentView[];
}

const mark = (n: number | null) => (n === null ? "—" : String(n));

/** The cohort as recorded, with the sample's rows marked; null where the request wasn't read from a document. */
export async function loadCohortView(ws: Workspace): Promise<CohortView | null> {
  const cohort = await loadRequestCohort(ws);
  if (!cohort) return null;
  const request = (await ws.exists(REQUEST)) ? await loadRequest(ws) : null;
  return { assessments: cohort.assessments.map((a) => assessmentView(cohort, a.assessment, request?.context.cohort_size ?? null)) };
}

export function assessmentView(cohort: RequestCohort, assessment: string, statedSize: number | null): CohortAssessmentView {
  const group = cohort.assessments.find((a) => a.assessment === assessment)!;
  const sampled = new Map(cohort.sampled.filter((s) => s.assessment === assessment).map((s) => [s.row, s.submission_id]));
  const rows: CohortRowView[] = group.rows.map((r) => ({
    row: r.row,
    initial: r.submitted ? mark(r.initial) : "No submission",
    agreed: mark(r.agreed),
    band: r.submitted && r.initial !== null ? (bandOfMark(r.initial, cohort.bands) ?? "—") : "—",
    sampled: sampled.get(r.row) ?? null,
  }));
  const submitted = group.rows.filter((r) => r.submitted);
  const bands: CohortBandView[] = cohort.bands.map((b) => ({
    label: b.label,
    cohort: rows.filter((r) => r.band === b.label).length,
    sample: rows.filter((r) => r.band === b.label && r.sampled !== null).length,
    stated: b.count,
  }));
  const unbanded = rows.filter((r, i) => group.rows[i].submitted && r.band === "—").length;
  const notes: string[] = [];
  if (statedSize !== null && statedSize !== group.rows.length) notes.push(`The request gives a cohort size of ${statedSize}, but its table lists ${group.rows.length} students for this assessment.`);
  if (!cohort.bands.length) notes.push("The request's band labels couldn't be read, so the rows aren't banded.");
  else if (unbanded) notes.push(`${unbanded} student(s) who submitted have a mark that is in none of the request's bands, or no mark.`);
  for (const b of bands) if (b.stated !== null && b.stated !== b.cohort) notes.push(`The request says ${b.stated} in ${b.label}, but its table has ${b.cohort}.`);
  return { name: assessment, students: group.rows.length, submitted: submitted.length, noSubmission: group.rows.length - submitted.length, bands, unbanded, rows, inSample: sampled.size, notes };
}
