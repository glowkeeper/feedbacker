/**
 * What the educator sees when writing one submission's feedback: for each criterion, and then overall, their mark
 * and comment, the AI's current draft (if any), and their feedback, each flagged when the marking it was made on has
 * changed since. Everything is read from the workspace; a record that doesn't load is reported, not skipped.
 */

import {
  approvedText,
  educatorMarking,
  entryMark,
  isStale,
  loadDrafts,
  loadFeedback,
  OVERALL,
  type EducatorMarking,
  type Feedback,
  type FeedbackDraft,
  type Workspace,
} from "../core/index.ts";
import { pyFormatG } from "../core/pytext.ts";
import { reviewChoices } from "./review.ts";

export interface FeedbackRow {
  target: string; // a criterion's id, or OVERALL
  title: string;
  marking: string | null; // the educator's mark and comment, in words; null while it can't be drafted from
  missing: string | null; // why it can't be drafted yet
  draft: FeedbackDraft | null;
  draftStale: boolean;
  feedback: Feedback | null;
  feedbackStale: boolean;
}

export interface FeedbackWork {
  id: string;
  pseudonym: string;
  text: string;
  rows: FeedbackRow[];
  next: { id: string; label: string } | null;
}

const comment = (c: string | null | undefined) => (c?.trim() ? `; your comment: ${c.trim()}` : "; no comment");

/** One submission's feedback, as it stands. */
export async function loadFeedbackWork(ws: Workspace, submissionId: string): Promise<FeedbackWork> {
  const m: EducatorMarking = await educatorMarking(ws, submissionId);
  const drafts = await loadDrafts(ws, submissionId);
  const given = await loadFeedback(ws, submissionId);
  const row = (target: string, title: string, marking: string | null): FeedbackRow => {
    const criterionId = target === OVERALL ? null : target;
    const draft = drafts.find((d) => d.criterion_id === criterionId) ?? null;
    const feedback = given.find((f) => f.criterion_id === criterionId) ?? null;
    return {
      target,
      title,
      marking: m.basis.has(target) ? marking : null,
      missing: m.missing.get(target) ?? null,
      draft,
      draftStale: draft !== null && isStale(m, criterionId, draft.drafted_from),
      feedback,
      feedbackStale: feedback !== null && isStale(m, criterionId, feedback.given_on),
    };
  };
  const rows = m.rubric.criteria.map((c) => {
    const e = m.entries.get(c.id);
    const mark = e ? entryMark(c, e) : null;
    return row(c.id, c.title, e ? `Your mark: ${mark === null ? (c.levels.find((l) => l.id === e.level_id)?.label ?? e.level_id) : pyFormatG(mark)}${comment(e.comment)}` : null);
  });
  rows.push(row(OVERALL, "Overall", m.overall ? `Your overall mark: ${pyFormatG(m.overall.mark)}${comment(m.overall.comment)}` : null));
  const choices = await reviewChoices(ws);
  return { id: submissionId, pseudonym: m.pseudonym, text: (await approvedText(ws, submissionId))[0], rows, next: choices[choices.findIndex((c) => c.id === submissionId) + 1] ?? null };
}

/** A row's status, under its heading: its feedback, or what it still needs. */
export function feedbackStatus(row: FeedbackRow): { kind: "done" | "attention" | "missing"; text: string } {
  if (row.feedback) return row.feedbackStale ? { kind: "attention", text: "Out of date: the marking has changed since; check it" } : { kind: "done", text: `Recorded${row.feedback.derived_from_ai ? ", adapted from the AI's draft" : ""}` };
  if (row.missing) return { kind: "missing", text: `Not yet: ${row.missing}` };
  return { kind: "missing", text: row.draft && !row.draftStale ? "Not yet: a draft is ready" : "Not yet" };
}
