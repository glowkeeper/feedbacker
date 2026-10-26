/**
 * The cohort a request document lists, kept without its students.
 *
 * A request document lists every student of the cohort with their marks. Only the sampled students' names and IDs belong in the
 * pseudonym key, so what is kept of the rest is anonymous: for each assessment, its rows by number with the marks and whether the
 * student submitted, the grade bands, which rows were sampled, and the document's hash (so a later reading of the document can be
 * checked to be the same one). That is enough to show the whole cohort and to draw a sample from it without holding who the others are.
 */

import { ownerOf } from "./assessment.ts";
import { Provenance, RequestCohort, type CohortBand } from "./models.ts";
import type { CohortRow, RequestFindings } from "./requestDocument.ts";
import { bandFor } from "./requestDocument.ts";
import type { Workspace } from "./workspace.ts";

export const REQUEST_COHORT = "request-cohort.json";

/** The row of each student in the findings, by assessment and student ID: its place in that assessment's table, from 1. */
export function rowNumbers(findings: RequestFindings): Map<string, number> {
  const out = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const r of findings.cohort) {
    const n = (counts.get(r.assessment) ?? 0) + 1;
    counts.set(r.assessment, n);
    out.set(`${r.assessment}\u0000${r.student_id}`, n);
  }
  return out;
}

/** A student's row number among those the request lists for an assessment, or null. */
export const rowOf = (findings: RequestFindings, assessment: string, studentId: string): number | null => rowNumbers(findings).get(`${assessment}\u0000${studentId}`) ?? null;

/** The students of one assessment, in the order the request lists them (a row's number is its place here, from 1). */
export const studentsOf = (findings: RequestFindings, assessment: string): CohortRow[] => findings.cohort.filter((r) => r.assessment === assessment);

/**
 * Record the cohort, from the findings of reading a request document, with the rows of `assessment` that were sampled and the
 * submission each became. Names and IDs are never kept here.
 */
export async function recordRequestCohort(
  ws: Workspace,
  findings: RequestFindings,
  options: { assessment: string; sampled: { row: number; submission_id: string }[]; now?: Date },
): Promise<RequestCohort> {
  const order: string[] = [];
  for (const r of findings.cohort) if (!order.includes(r.assessment)) order.push(r.assessment);
  const cohort = RequestCohort.parse({
    source_sha256: findings.source_sha256,
    assessments: order.map((assessment) => {
      const students = studentsOf(findings, assessment);
      return {
        assessment,
        title: students[0].title,
        weight: students[0].weight,
        rows: students.map((r, i) => ({ row: i + 1, initial: r.initial, agreed: r.agreed, submitted: r.submitted })),
      };
    }),
    bands: findings.bands.map((b) => ({ label: b.label, from: b.from, to: b.to, count: b.count })),
    sampled: options.sampled.map((s) => ({ assessment: options.assessment, row: s.row, submission_id: s.submission_id })),
    provenance: Provenance.parse({
      source: `file:sha256:${findings.source_sha256}`,
      transformation: "imported",
      actor: ownerOf(ws),
      timestamp: (options.now ?? new Date()).toISOString(),
      input_hashes: [findings.source_sha256],
    }),
  });
  await ws.writeJson(REQUEST_COHORT, cohort, { private: true });
  return cohort;
}

/** The recorded cohort, or null where the request wasn't read from a document: nothing to show. */
export async function loadRequestCohort(ws: Workspace): Promise<RequestCohort | null> {
  if (!(await ws.exists(REQUEST_COHORT))) return null;
  return RequestCohort.parse(await ws.readJson(REQUEST_COHORT));
}

/** The band a mark falls in, by the recorded bands' own labels, or null. */
export const bandOfMark = (mark: number, bands: CohortBand[]): string | null => bandFor(mark, bands.map((b) => ({ label: b.label, from: b.from, to: b.to, count: b.count })));
