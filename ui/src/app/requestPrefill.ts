/**
 * What an assessment's Request step takes from the module's cohort without reading the request document again: which of the module's assessments this
 * one is (by its name, and only where one fits: an assessment the document doesn't list isn't taken for the one it does), the number of students listed for it,
 * and the grade bands (only when every band's count is known, as a document's own band distribution is).
 */

import { moduleCohortAssessment, type RequestCohort } from "../core/index.ts";

export interface ModulePrefill {
  /** The module's name for this assessment; empty where it can't be told. */
  assessment: string;
  /** The students the request lists for it, as the cohort size to check; null where the assessment isn't known. */
  cohort: string | null;
  /** The bands with their counts; null unless every band's count is known. */
  bands: { label: string; count: string }[] | null;
}

export function moduleRequestPrefill(cohort: RequestCohort, assessmentName: string): ModulePrefill {
  const assessment = moduleCohortAssessment(cohort, assessmentName) ?? "";
  const group = cohort.assessments.find((a) => a.assessment === assessment);
  const counted = cohort.bands.length > 0 && cohort.bands.every((b) => b.count !== null);
  return {
    assessment,
    cohort: group ? String(group.rows.length) : null,
    bands: counted ? cohort.bands.map((b) => ({ label: b.label, count: String(b.count) })) : null,
  };
}
