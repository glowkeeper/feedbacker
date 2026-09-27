/**
 * What the moderator sees when reviewing one sampled submission (#19): the
 * approved anonymised text, the brief, the source rubric, every marker's
 * record, the AI reading, and the judgements recorded so far. Only approved
 * text is shown. Anything that doesn't load is reported with the rest, so a
 * damaged record never hides what else there is to see.
 */

import {
  approvedBriefText,
  approvedText,
  BRIEF,
  loadJudgements,
  loadMarking,
  loadReadings,
  loadRequest,
  loadRubric,
  readingPath,
  REQUEST,
  RUBRIC,
  type AISuggestion,
  type ModeratorJudgement,
  type OriginalAssessment,
  type Rubric,
  type Workspace,
  WorkspaceError,
} from "../core/index.ts";
import { markingRecords } from "./markingRecords.ts";

export interface Review {
  id: string;
  pseudonym: string;
  text: string | null; // the approved anonymised text; null if it isn't approved
  brief: string | null; // the approved brief, if there is one
  rubric: Rubric;
  markings: OriginalAssessment[];
  readings: Map<string, AISuggestion>; // by criterion
  judgements: Map<string, ModeratorJudgement>; // by criterion
  notes: string[]; // what isn't there yet
  problems: string[]; // what didn't load
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The sampled submissions, for choosing one to review. */
export async function reviewChoices(ws: Workspace): Promise<{ id: string; label: string }[]> {
  if (!(await ws.exists(REQUEST))) return [];
  return (await loadRequest(ws)).sample.map((s) => ({ id: s.submission_id, label: `${s.submission_id} ${s.pseudonym}` }));
}

export async function loadReview(ws: Workspace, submissionId: string): Promise<Review> {
  if (!(await ws.exists(RUBRIC))) throw new WorkspaceError("import the source rubric before reviewing");
  const rubric = await loadRubric(ws);
  const s = (await loadRequest(ws)).sample.find((x) => x.submission_id === submissionId);
  if (!s) throw new WorkspaceError(`${submissionId} is not in the sample`);
  const review: Review = {
    id: submissionId,
    pseudonym: s.pseudonym,
    text: null,
    brief: null,
    rubric,
    markings: [],
    readings: new Map(),
    judgements: new Map(),
    notes: [],
    problems: [],
  };
  try {
    review.text = (await approvedText(ws, submissionId))[0];
  } catch (err) {
    review.problems.push(`The submission can't be reviewed yet: ${message(err)}.`);
  }
  if (await ws.exists(BRIEF)) {
    try {
      review.brief = (await approvedBriefText(ws))[0];
    } catch (err) {
      review.notes.push(`The brief isn't shown: ${message(err)}.`);
    }
  } else {
    review.notes.push("No brief has been imported.");
  }
  const records = (await markingRecords(ws)).filter((r) => r.submissionId === submissionId);
  if (!records.length) review.notes.push("No original marking has been imported or entered.");
  for (const r of records) {
    if (r.problem) {
      review.problems.push(`${r.file}: ${r.problem}`);
      continue;
    }
    try {
      review.markings.push(await loadMarking(ws, submissionId, r.markerLabel!));
    } catch (err) {
      review.problems.push(`${r.file}: ${message(err)}`);
    }
  }
  const unconfirmed = review.markings.filter((m) => m.confirmed_at === null).map((m) => m.marker_label);
  if (unconfirmed.length) review.notes.push(`Not yet confirmed: the ${unconfirmed.join(", ")} marking.`);
  if (await ws.exists(readingPath(submissionId))) {
    try {
      for (const r of await loadReadings(ws, submissionId)) review.readings.set(r.criterion_id, r);
    } catch (err) {
      review.problems.push(message(err));
    }
  } else {
    review.notes.push("There is no AI reading of this submission.");
  }
  try {
    for (const j of await loadJudgements(ws, submissionId)) review.judgements.set(j.criterion_id, j);
  } catch (err) {
    review.problems.push(message(err));
  }
  return review;
}

/** Where on the marked page an inline comment sits, in words: the position is only approximate. */
export function whereOnPage(page: number | null, position: number | null): string {
  if (page === null) return "position not known";
  if (position === null) return `page ${page}`;
  const part = position < 1 / 3 ? "top" : position < 2 / 3 ? "middle" : "bottom";
  return `page ${page}, near the ${part}`;
}
