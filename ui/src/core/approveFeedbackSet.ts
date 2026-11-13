/**
 * Approving what many students will receive in one action, after reviewing by exception (ADR 0012's design, applied to marks and feedback).
 *
 * The safeguard is unchanged: each submission is approved explicitly, on the digest of exactly what its student will receive, and a later change clears it.
 * What changes is that the educator may look properly at the submissions the cohort checks flag (opening what each will receive), read the rest in a
 * list that shows each one's mark and full feedback, and approve the set. A flagged submission that has not been opened, as it now is, is not approved by
 * this action, and is said. Each approval records that it was made in a set, how big, how many were flagged, and what became of this submission.
 */

import { UnapprovedText } from "./boundary.ts";
import { feedbackExceptions } from "./cohortFeedback.ts";
import { loadCohort } from "./cohort.ts";
import { approvalState, approveSubmission, type ApprovalState, type StudentFeedback } from "./markingExport.ts";
import type { Workspace } from "./workspace.ts";
import { WorkspaceError } from "./workspace.ts";

/** A submission whose marks and feedback are ready to approve (or approved, and changed since), as the set lists it. */
export interface WaitingFeedback {
  id: string;
  label: string;
  /** What the student will receive. */
  feedback: StudentFeedback;
  /** Of that content, and of the flags accepted on it: what the educator is shown, and what they approve. */
  digest: string;
  /** Why it must be opened before it can be in a set: the cohort checks' messages. Empty when it need not be. */
  exceptions: string[];
}

/**
 * Of submissions' approval states, the ones ready to approve and not yet approved on what they are now, in the order given, each with why it is an exception,
 * if it is. A state is null for a submission that can't be read as it stands (its text not yet approved, say): it isn't ready, and is left out.
 */
export function waitingOf(submissions: { id: string; label: string; state: ApprovalState | null }[], exceptions: Map<string, string[]>): WaitingFeedback[] {
  const out: WaitingFeedback[] = [];
  for (const { id, label, state } of submissions) {
    if (!state || state.current || !state.feedback || !state.digest) continue;
    const why = [...(exceptions.get(id) ?? [])];
    // Marks taken from the AI's proposals, or feedback recorded from its drafts, in a set are not exceptions: the educator was shown each in full when they were taken, and the list here
    // shows each student's mark and full feedback again, to be read. Their records say they were taken in a set (state.takenFromAi, state.draftsInSet), and the approval says it was made in one.
    out.push({ id, label, feedback: state.feedback, digest: state.digest, exceptions: why });
  }
  return out;
}

/** Every submission ready to approve and not yet approved on what it is now, in the cohort's order, with why each is an exception, if it is. */
export async function waitingFeedback(ws: Workspace): Promise<WaitingFeedback[]> {
  const submissions: { id: string; label: string; state: ApprovalState | null }[] = [];
  for (const s of (await loadCohort(ws)).submissions) {
    let state: ApprovalState | null = null;
    try {
      state = await approvalState(ws, s.submission_id);
    } catch (err) {
      // One that can't be read as it stands (its text not yet approved, say) isn't ready: left out, as one that is not ready is.
      if (!(err instanceof UnapprovedText || err instanceof WorkspaceError)) throw err;
    }
    submissions.push({ id: s.submission_id, label: `${s.submission_id} ${s.pseudonym}`, state });
  }
  return waitingOf(submissions, await feedbackExceptions(ws));
}

/**
 * What the educator was shown (the submissions they opened, and those they confirmed they read), and is no longer waiting: one approved since on what it is now
 * is counted as such; one that has become unready (its marks or feedback changed, or a new flag is open) is named as left out, since it is not in the list now.
 */
async function reconcileShown(ws: Workspace, waiting: WaitingFeedback[], options: { opened: Record<string, string>; read: Record<string, string> | null }, result: FeedbackSetApproval): Promise<void> {
  const now = new Set(waiting.map((w) => w.id));
  const shown = [...new Set([...Object.keys(options.opened), ...Object.keys(options.read ?? {})])].filter((id) => !now.has(id));
  if (!shown.length) return;
  const labels = new Map((await loadCohort(ws)).submissions.map((s) => [s.submission_id, `${s.submission_id} ${s.pseudonym}`]));
  for (const id of shown) {
    const label = labels.get(id) ?? id;
    try {
      const state = await approvalState(ws, id);
      if (state.current) result.alreadyApproved.push(id);
      else result.skipped.push({ id, label, why: `it is no longer ready to approve: ${state.problems.length ? state.problems.join("; ") : "what its student will receive changed after the list was shown"}` });
    } catch (err) {
      if (!(err instanceof UnapprovedText || err instanceof WorkspaceError)) throw err;
      result.skipped.push({ id, label, why: `it can't be read now: ${err.message}` });
    }
  }
}

export interface FeedbackSetApproval {
  /** The submissions approved, by ID. */
  approved: string[];
  /** The submissions that weren't, with why. */
  skipped: { id: string; label: string; why: string }[];
  /** How many submissions were waiting for approval, and how many of them were exceptions. */
  size: number;
  flagged: number;
  /** Submissions the educator was shown that were approved on what they are now since, so there was nothing to do for them. */
  alreadyApproved: string[];
}

/**
 * Approve every submission waiting for approval, except the exceptions the educator has not opened. `opened` is what they opened, by submission ID, with
 * the digest of what they were shown (so one that changed since is not counted as opened). `read` is their confirmation that they read the rest, as
 * the list showed them: those submissions by ID, with the digest of each (null if they haven't confirmed). Without it nothing is approved, when there
 * are any that are not exceptions; and one that has changed since they confirmed is not approved by it (they read something else).
 */
export async function approveFeedbackSet(ws: Workspace, options: { opened: Record<string, string>; read: Record<string, string> | null; now?: Date }): Promise<FeedbackSetApproval> {
  const waiting = await waitingFeedback(ws);
  const flagged = waiting.filter((w) => w.exceptions.length).length;
  const result: FeedbackSetApproval = { approved: [], skipped: [], size: waiting.length, flagged, alreadyApproved: [] };
  await reconcileShown(ws, waiting, options, result);
  if (!waiting.length) return result;
  const confirmed = options.read !== null;
  if (waiting.length > flagged && !confirmed) {
    throw new WorkspaceError("confirm that you have read the submissions that are not flagged, then approve the set; nothing was approved");
  }
  for (const w of waiting) {
    const opened = options.opened[w.id] === w.digest;
    if (w.exceptions.length && !opened) {
      result.skipped.push({ id: w.id, label: w.label, why: "it is flagged, and what its student will receive hasn't been opened as it now is" });
      continue;
    }
    // One that is not flagged is approved on the confirmation only as it was when they confirmed (or if they opened it as it now is).
    if (!w.exceptions.length && !opened && options.read![w.id] !== w.digest) {
      result.skipped.push({ id: w.id, label: w.label, why: "what its student will receive isn't what you confirmed you had read (it changed, or wasn't listed): read it, and confirm again" });
      continue;
    }
    try {
      await approveSubmission(ws, w.id, options.now, w.digest, { size: waiting.length, flagged, flagged_this: w.exceptions.length > 0, opened_this: opened, read_unflagged: confirmed });
      result.approved.push(w.id);
    } catch (err) {
      if (!(err instanceof WorkspaceError)) throw err;
      result.skipped.push({ id: w.id, label: w.label, why: err.message });
    }
  }
  return result;
}
