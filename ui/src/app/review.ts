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
  currentReview,
  loadJudgements,
  loadVerdict,
  readingProblems,
  staleJudgements,
  staleVerdict,
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
  type ReviewMode,
  type Rubric,
  type SubmissionVerdict,
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
  stale: Set<string>; // criteria whose judgement was of an earlier approved text
  mode: ReviewMode | null; // null until the moderator chooses
  revealedAt: string | null; // when a blind review was revealed
  verdict: SubmissionVerdict | null; // the moderator's verdict on the marking, once shown
  verdictStale: boolean; // it was given on other marking, or another approved text, than there is now
  shown: boolean; // whether the original marking and the AI reading are shown (they are not even loaded otherwise)
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
    stale: new Set(),
    mode: null,
    revealedAt: null,
    verdict: null,
    verdictStale: false,
    shown: false,
    notes: [],
    problems: [],
  };
  let approved: string | null = null; // the approved text's hash
  let approvalId: string | null = null;
  try {
    const [text, approval] = await approvedText(ws, submissionId);
    review.text = text;
    approved = approval.approved_text_sha256;
    approvalId = approval.id;
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
  try {
    const state = await currentReview(ws, submissionId); // fails when it can't be established
    review.mode = state?.mode ?? null;
    review.revealedAt = state?.revealed_at ?? null;
    review.shown = review.mode === "open" || review.revealedAt !== null;
  } catch (err) {
    review.problems.push(message(err)); // nothing is shown while it isn't known how the submission is reviewed
  }
  if (review.shown) await loadShown(ws, review, approved, approvalId);
  else if (review.mode === "blind") review.notes.push("Blind review: the original marking and the AI reading stay hidden until you have recorded a level for every criterion and reveal them.");
  try {
    const judgements = await loadJudgements(ws, submissionId);
    for (const j of judgements) review.judgements.set(j.criterion_id, j);
    review.stale = new Set(staleJudgements(judgements, approved, rubric));
    review.verdictStale = review.verdict !== null && staleVerdict(review.verdict, approved, review.markings, rubric, judgements);
    if (review.verdictStale) review.problems.push("Your verdict was recorded against earlier marking, an earlier approved text or rubric, or other marks of yours; check it again.");
    const stale = [...review.stale].map((cid) => rubric.criteria.find((c) => c.id === cid)?.title ?? cid);
    if (stale.length) review.problems.push(`Your judgement of ${stale.join(", ")} was recorded against an earlier approved text of this submission, or an earlier source rubric; check it again.`);
  } catch (err) {
    review.problems.push(message(err));
  }
  return review;
}

/** The original marking and the AI reading, loaded only when they may be shown. */
async function loadShown(ws: Workspace, review: Review, approved: string | null, approvalId: string | null) {
  const submissionId = review.id;
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
      const readings = await loadReadings(ws, submissionId);
      const problems = readingProblems(submissionId, readings, approved, { approvalId, rubric: review.rubric });
      if (problems.length) review.problems.push(...problems);
      else for (const r of readings) review.readings.set(r.criterion_id, r);
    } catch (err) {
      review.problems.push(message(err));
    }
  } else {
    review.notes.push("There is no AI reading of this submission.");
  }
  try {
    review.verdict = await loadVerdict(ws, submissionId);
    // Whether it is still current is known once the judgements are loaded (loadReview).
  } catch (err) {
    review.problems.push(message(err));
  }
}

/** Where on the marked page an inline comment sits, in words: the position is only approximate. */
export function whereOnPage(page: number | null, position: number | null): string {
  if (page === null) return "position not known";
  if (position === null) return `page ${page}`;
  const part = position < 1 / 3 ? "top" : position < 2 / 3 ? "middle" : "bottom";
  return `page ${page}, near the ${part}`;
}

/** The submission's text split around a passage, for highlighting it. */
export interface Passage {
  before: string;
  match: string;
  after: string;
}

/** A verified quote's place in the text, by its code-point offsets (as the reading records them); null if they don't fit the text. */
export function passageAt(text: string, start: number | null, end: number | null): Passage | null {
  if (start === null || end === null || start < 0 || end <= start) return null;
  const points = Array.from(text);
  if (end > points.length) return null;
  return { before: points.slice(0, start).join(""), match: points.slice(start, end).join(""), after: points.slice(end).join("") };
}

/** Where a passage appears in the text, exactly as written (its first occurrence); null if it doesn't, so nothing is guessed. */
export function passageOf(text: string, passage: string | null): Passage | null {
  const needle = passage?.trim() ?? "";
  const at = needle ? text.indexOf(needle) : -1;
  if (at < 0) return null;
  return { before: text.slice(0, at), match: needle, after: text.slice(at + needle.length) };
}
