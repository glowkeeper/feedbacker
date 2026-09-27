/**
 * What a moderator's record was made against, so it can be told when that
 * has changed (#19). A judgement records the approved text and the source
 * rubric; a verdict records the approved text and each marking record it
 * judged. The hashes go in the record's `provenance.input_hashes`.
 *
 * The rubric's digest covers its content, not its version label (a re-import
 * often keeps version "1"). A marking record's digest covers everything the
 * moderator is shown of it (the marks, levels, comments and import notes),
 * not its confirmation, so confirming a record doesn't make a verdict on it
 * stale.
 */

import type { ModeratorJudgement, OriginalAssessment, Rubric, SubmissionVerdict } from "./models.ts";
import { sha256Text } from "./text.ts";

export const rubricDigest = (rubric: Rubric) => sha256Text(JSON.stringify(rubric.criteria));

export const markingDigest = (a: OriginalAssessment) =>
  sha256Text(
    JSON.stringify([a.submission_id, a.marker_label, a.criterion_marks, a.overall_mark, a.raw_overall, a.raw_rubric_total, a.overall_comment, a.annotations, a.import_notes]),
  );

/** What a judgement is made against: the approved text and the source rubric. */
export const judgementInputs = (approvedSha256: string, rubric: Rubric) => [approvedSha256, rubricDigest(rubric)];

/** What a verdict is made against: the approved text and every marking record of the submission. */
export const verdictInputs = (approvedSha256: string, markings: OriginalAssessment[]) => [approvedSha256, ...markings.map(markingDigest).sort()];

/**
 * The criteria whose judgement was made against something other than the
 * text approved now or the source rubric as it is now. With no approved text,
 * nothing can be compared, so nothing is reported.
 */
export function staleJudgements(judgements: ModeratorJudgement[], approvedSha256: string | null, rubric: Rubric): string[] {
  if (approvedSha256 === null) return [];
  const now = judgementInputs(approvedSha256, rubric);
  return judgements.filter((j) => !now.every((h) => j.provenance.input_hashes.includes(h))).map((j) => j.criterion_id);
}

/** Whether a verdict was made against other marking, or another approved text, than there is now. */
export function staleVerdict(verdict: SubmissionVerdict, approvedSha256: string | null, markings: OriginalAssessment[]): boolean {
  if (approvedSha256 === null) return false;
  const now = verdictInputs(approvedSha256, markings);
  const was = [...verdict.provenance.input_hashes].sort();
  return now.length !== was.length || [...now].sort().some((h, i) => h !== was[i]);
}
