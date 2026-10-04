/**
 * What the moderator sees when reviewing one sampled submission (or the
 * educator, marking one of the cohort): the approved anonymised text, the
 * brief, the source rubric, every marker's record (a moderation's only), the
 * AI reading (a marking workspace's proposals), and the judgements recorded so far. Only approved
 * text is shown. Anything that doesn't load is reported with the rest, so a
 * damaged record never hides what else there is to see.
 */

import {
  approvedBriefText,
  approvedText,
  BRIEF,
  currentReview,
  entryMark,
  loadJudgements,
  loadVerdict,
  readingProblems,
  staleJudgements,
  staleVerdict,
  loadMarking,
  listSubmissions,
  loadReadings,
  loadRubric,
  readingPath,
  RUBRIC,
  submissionsKnown,
  submissionsName,
  type AISuggestion,
  type Criterion,
  type ModeratorJudgement,
  type OriginalAssessment,
  type ReviewMode,
  type Rubric,
  type SubmissionVerdict,
  type Workspace,
  WorkspaceError,
} from "../core/index.ts";
import { pyFormatG } from "../core/pytext.ts";
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

/** The workspace's submissions (sampled, or the cohort), for choosing one to review or mark. */
export async function reviewChoices(ws: Workspace): Promise<{ id: string; label: string }[]> {
  if (!(await submissionsKnown(ws))) return [];
  return (await listSubmissions(ws)).map((s) => ({ id: s.submission_id, label: `${s.submission_id} ${s.pseudonym}` }));
}

const isMarking = (ws: Workspace) => ws.manifest.workspace_type === "marking";

export async function loadReview(ws: Workspace, submissionId: string): Promise<Review> {
  if (!(await ws.exists(RUBRIC))) throw new WorkspaceError("import the source rubric before reviewing");
  const rubric = await loadRubric(ws);
  const s = (await listSubmissions(ws)).find((x) => x.submission_id === submissionId);
  if (!s) throw new WorkspaceError(`${submissionId} is not in ${submissionsName(ws)}`);
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
  else if (review.mode === "blind") {
    review.notes.push(
      isMarking(ws)
        ? "Marking blind: the AI's proposals stay hidden until you have recorded a level for every criterion and reveal them."
        : "Blind review: the original marking and the AI reading stay hidden until you have recorded a level for every criterion and reveal them.",
    );
  }
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
  if (isMarking(ws)) {
    // A marking workspace has no original marking to show, and no verdict on it: only the AI's proposals.
    await loadReadingsShown(ws, review, approved, approvalId, "There are no AI proposals for this submission.");
    return;
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
  await loadReadingsShown(ws, review, approved, approvalId, "There is no AI reading of this submission.");
  try {
    review.verdict = await loadVerdict(ws, submissionId);
    // Whether it is still current is known once the judgements are loaded (loadReview).
  } catch (err) {
    review.problems.push(message(err));
  }
}

/** The AI reading (or a marking workspace's proposals), only when current: of the text as approved now, under this approval, against the rubric as it is now. */
async function loadReadingsShown(ws: Workspace, review: Review, approved: string | null, approvalId: string | null, none: string) {
  const submissionId = review.id;
  if (!(await ws.exists(readingPath(submissionId)))) {
    review.notes.push(none);
    return;
  }
  try {
    const readings = await loadReadings(ws, submissionId);
    const problems = readingProblems(submissionId, readings, approved, { approvalId, rubric: review.rubric });
    if (problems.length) review.problems.push(...problems);
    else for (const r of readings) review.readings.set(r.criterion_id, r);
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

/**
 * A verified quote's place in the text, by its code-point offsets (as the reading records them); null unless the text
 * at those offsets is exactly the quote, so a record whose offsets don't match its quote never highlights something else.
 */
export function passageAt(text: string, quote: string, start: number | null, end: number | null): Passage | null {
  if (start === null || end === null || start < 0 || end <= start) return null;
  const points = Array.from(text);
  if (end > points.length) return null;
  const match = points.slice(start, end).join("");
  if (match !== quote) return null;
  return { before: points.slice(0, start).join(""), match, after: points.slice(end).join("") };
}

/**
 * Where a passage appears in the text, exactly as written; null if it doesn't, or if it appears more than once (which
 * occurrence is meant can't be known), so nothing is guessed.
 */
export function passageOf(text: string, passage: string | null): Passage | null {
  const needle = passage?.trim() ?? "";
  const at = needle ? text.indexOf(needle) : -1;
  if (at < 0 || text.indexOf(needle, at + 1) >= 0) return null;
  return { before: text.slice(0, at), match: needle, after: text.slice(at + needle.length) };
}

/**
 * A criterion's status under its button, with the mark recorded: "Judged: 68" (or "Marked: 68" when marking), or
 * the level's label for a level with no mark; "Out of date: 68" when it was recorded against an earlier text or
 * rubric; or "Not yet judged".
 */
export function criterionStatus(r: Review, c: Criterion, done: "Judged" | "Marked"): { kind: "done" | "attention" | "missing"; text: string } {
  const j = r.judgements.get(c.id);
  if (!j) return { kind: "missing", text: `Not yet ${done.toLowerCase()}` };
  const entry = j.revised ?? j.first;
  const mark = entryMark(c, entry);
  const what = mark !== null ? pyFormatG(mark) : (c.levels.find((l) => l.id === entry.level_id)?.label ?? entry.level_id);
  return r.stale.has(c.id) ? { kind: "attention", text: `Out of date: ${what}` } : { kind: "done", text: `${done}: ${what}` };
}
