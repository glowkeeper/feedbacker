/**
 * What the educator sees when marking one submission of the cohort: the review (the approved text, the brief, the
 * rubric, the AI's proposals once they may be shown, and the levels recorded so far), with the overall mark recorded,
 * the mark their criterion marks imply, and the provisional mark the AI's proposed levels imply. The provisional mark
 * is only worked out once the proposals may be shown, so a blind marking stays blind.
 */

import { loadGradeScale, loadSubmissionMark, proposeOverall, provisionalMark, submissionMarkStale, type GradeScale, type SubmissionMark, type Workspace } from "../core/index.ts";
import { pyFormatG } from "../core/pytext.ts";
import { yourImpliedMark } from "./comparison.ts";
import { loadReview, reviewChoices, type Review } from "./review.ts";

export interface MarkingWork {
  review: Review;
  overall: SubmissionMark | null; // the educator's overall mark and comment, once recorded
  overallStale: boolean; // given on other criterion marks than there are now
  scale: GradeScale; // what the overall mark is out of, and the grade points it is rounded to
  implied: number | null; // the overall mark the educator's current criterion marks propose, on the scale and rounded to its grade points; null until every criterion is marked (and the rubric has weights)
  impliedWorked: number | null; // what they imply before any rounding: the same as `implied` when nothing is rounded
  provisional: { mark: number; worked: number } | { missing: string } | null; // from the AI's proposed levels; null while they aren't shown, or there are none
  next: { id: string; label: string } | null; // the next submission in the cohort, for moving on in one action
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function loadMarkingWork(ws: Workspace, submissionId: string): Promise<MarkingWork> {
  const review = await loadReview(ws, submissionId);
  const scale = await loadGradeScale(ws);
  const percentage = yourImpliedMark(review);
  const proposal = percentage === null ? null : proposeOverall(percentage, scale);
  const work: MarkingWork = { review, overall: null, overallStale: false, scale, implied: proposal?.mark ?? null, impliedWorked: proposal?.worked ?? null, provisional: null, next: null };
  try {
    work.overall = await loadSubmissionMark(ws, submissionId);
    if (work.overall && review.text !== null) work.overallStale = await submissionMarkStale(ws, work.overall);
    if (work.overallStale) review.problems.push("Your overall mark was given on other criterion marks than there are now; check it again.");
  } catch (err) {
    review.problems.push(message(err));
  }
  if (review.shown && review.readings.size) {
    const p = provisionalMark(review.rubric.criteria, (id) => review.readings.get(id));
    work.provisional = "mark" in p ? proposeOverall(p.mark, scale) : p;
  }
  const choices = await reviewChoices(ws);
  work.next = choices[choices.findIndex((c) => c.id === submissionId) + 1] ?? null;
  return work;
}

/** The provisional mark in words, always labelled as provisional and as the AI's, never as a mark. */
export function provisionalText(work: MarkingWork): string | null {
  const p = work.provisional;
  if (!p) return null;
  if (!("mark" in p)) return `No provisional mark: ${p.missing}`;
  return `Provisional mark ${pyFormatG(p.mark)}${p.worked === p.mark ? "" : ` (${pyFormatG(p.worked)} before rounding to the grade scale)`}, from the AI's proposed levels (not a mark)`;
}
