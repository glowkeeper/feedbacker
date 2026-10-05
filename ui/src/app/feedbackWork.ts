/**
 * What the educator sees when writing one submission's feedback: for each criterion, and then overall, their mark
 * and comment, the AI's current draft (if any), and their feedback, each flagged when the marking it was made on has
 * changed since. Everything is read from the workspace; a record that doesn't load is reported, not skipped.
 */

import {
  approvedText,
  educatorMarking,
  feedbackFlags,
  checkCriterionFeedback,
  checkFeedback,
  loadPraise,
  entryMark,
  isStale,
  loadDrafts,
  loadFeedback,
  OVERALL,
  type EducatorMarking,
  type Feedback,
  type FeedbackDraft,
  type Flag,
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
  flags: Flag[]; // the checks' flags on the recorded feedback, against the marks as they are now
  open: Flag[]; // those not accepted for this text
  check: (text: string) => Flag[]; // the same checks on any text, such as what is in the box before it is recorded
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
  const checked = new Map((await feedbackFlags(ws, submissionId)).map((f) => [f.target, f]));
  const praise = await loadPraise(ws);
  /** The checks on a target's text, against its mark as it is now (none while it can't be checked). */
  const checkerOf = (target: string): ((text: string) => Flag[]) => {
    if (target === OVERALL) return m.overall ? (text) => checkFeedback(text, m.overall!.mark, 100, praise) : () => [];
    const c = m.rubric.criteria.find((x) => x.id === target);
    const e = m.entries.get(target);
    return c && e ? (text) => checkCriterionFeedback(text, c, e.level_id, entryMark(c, e), praise) : () => [];
  };
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
      flags: checked.get(target)?.flags ?? [],
      open: checked.get(target)?.open ?? [],
      check: checkerOf(target),
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
  if (row.feedback && row.feedbackStale) return { kind: "attention", text: "Out of date: the marking has changed since; check it" };
  if (row.feedback && row.open.length) return { kind: "attention", text: `Recorded; ${row.open.length === 1 ? "1 flag" : `${row.open.length} flags`} to check` };
  if (row.feedback) return { kind: "done", text: `Recorded${row.feedback.derived_from_ai ? ", adapted from the AI's draft" : ""}${row.flags.length ? "; its flags are accepted" : ""}` };
  if (row.missing) return { kind: "missing", text: `Not yet: ${row.missing}` };
  return { kind: "missing", text: row.draft && !row.draftStale ? "Not yet: a draft is ready" : "Not yet" };
}

export interface CohortChecks {
  id: string;
  label: string;
  recorded: number; // pieces of feedback recorded (criteria and overall)
  open: number; // flags not accepted
  accepted: number;
  problem: string | null; // its feedback can't be checked yet, and why
}

/** Every submission's checks, for the cohort's list: how many flags are open, and how many accepted. */
export async function cohortChecks(ws: Workspace): Promise<CohortChecks[]> {
  const out: CohortChecks[] = [];
  for (const c of await reviewChoices(ws)) {
    const row: CohortChecks = { id: c.id, label: c.label, recorded: 0, open: 0, accepted: 0, problem: null };
    try {
      const flags = await feedbackFlags(ws, c.id);
      row.recorded = flags.length;
      row.open = flags.reduce((n, f) => n + f.open.length, 0);
      row.accepted = flags.reduce((n, f) => n + f.flags.length - f.open.length, 0);
    } catch (err) {
      row.problem = err instanceof Error ? err.message : String(err);
    }
    out.push(row);
  }
  return out;
}
