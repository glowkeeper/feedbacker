/**
 * Recording the AI's unflagged drafts of feedback for many submissions in one action, by exception (ADR 0015).
 *
 * The educator still reads or skims every piece before it is recorded, and approves every word a student receives at Export. What changes is that the unflagged
 * drafts of the whole cohort can be recorded in one action, after a list that shows each piece's full text and a confirmation that the educator skimmed it. A
 * piece that is flagged is never in the set: it is recorded by hand. A draft is flagged when a check on it against the mark would raise a flag (praise that
 * doesn't fit a low mark, no next step, another mark named, an anonymised value, a cut-off ending), or the cohort checks flag it (much shorter or longer than the
 * rest at its level, or nearly the same as another's), judged on the drafts together with the feedback already recorded. A draft drafted from other marking than
 * there is now is not current, and is not offered.
 *
 * Each piece is recorded as it would be on its own (its own record, from the draft, derived from the AI), and says it was recorded in a set, not one by one.
 * At Export it is skimmed in the list with the rest, as every approval in a set is (approveFeedbackSet.ts); recording the feedback again by hand ends the mark.
 */

import { UnapprovedText } from "./boundary.ts";
import { loadCohort } from "./cohort.ts";
import { loadCohortFeedback } from "./cohortFeedback.ts";
import { educatorMarking, loadDrafts, loadFeedback, OVERALL, recordFeedback, targetOf } from "./drafting.ts";
import { checkCriterionFeedback, checkFeedback, checkOverallFeedback, blocks, loadPraise, type Flag } from "./feedbackChecks.ts";
import { entryMark } from "./marks.ts";
import { percentOfOverall } from "./gradeScale.ts";
import { sha256Text } from "./text.ts";
import type { Workspace } from "./workspace.ts";
import { WorkspaceError } from "./workspace.ts";

/** One piece of feedback whose current draft would be recorded, as the list shows it. */
export interface DraftPiece {
  /** A criterion's id, or OVERALL. */
  target: string;
  title: string;
  draftId: string;
  /** The draft, in full, as it would be recorded. */
  text: string;
}

/** A piece whose draft is flagged, and so is never in the set: it is recorded by hand. */
export interface HeldPiece {
  target: string;
  title: string;
  /** Why, each saying what and never quoting the text. */
  why: string[];
}

/** A submission with at least one piece whose draft can be recorded. */
export interface DraftedSubmission {
  id: string;
  label: string;
  /** The educator's overall mark, for reading the feedback against. */
  mark: number | null;
  pieces: DraftPiece[];
  held: HeldPiece[];
  /** Of exactly what would be recorded: what the educator is shown, and what they confirm they skimmed. */
  digest: string;
}

export interface NotListed {
  id: string;
  label: string;
  why: string;
  /** Its drafts that are flagged and held back, when that is why nothing of it is listed. */
  held?: HeldPiece[];
}

/** What the checks need that is the same for every submission: the praise words and settings, and which submissions the cohort checks flag. */
async function checksFor(ws: Workspace) {
  const praise = await loadPraise(ws);
  // The cohort checks, over the drafts together with what is recorded: which submissions are unusual on which target.
  const outliers = new Map<string, Set<string>>();
  for (const view of await loadCohortFeedback(ws, { withDrafts: true })) {
    outliers.set(view.target, new Set(view.outliers.flatMap((o) => o.submissionIds)));
  }
  return { praise, outliers };
}

/** One submission's drafts as they can be recorded now: the submission with pieces to record, or why it has none. Read again at the moment of recording. */
async function draftedFor(ws: Workspace, checks: Awaited<ReturnType<typeof checksFor>>, s: { submission_id: string; pseudonym: string }): Promise<DraftedSubmission | NotListed> {
  const { praise, outliers } = checks;
  const id = s.submission_id;
  const label = `${id} ${s.pseudonym}`;
  const no = (why: string): NotListed => ({ id, label, why });
  let m;
  try {
    m = await educatorMarking(ws, id);
  } catch (err) {
    if (!(err instanceof WorkspaceError || err instanceof UnapprovedText)) throw err;
    return no("its marking can't be read yet");
  }
  const recorded = new Set((await loadFeedback(ws, id)).map((f) => targetOf(f.criterion_id)));
  const drafts = await loadDrafts(ws, id);
  const pieces: DraftPiece[] = [];
  const held: HeldPiece[] = [];
  const targets = [...m.rubric.criteria.map((c) => ({ target: c.id, title: c.title })), { target: OVERALL, title: "Overall" }];
  for (const { target, title } of targets) {
    if (recorded.has(target)) continue; // recorded already: the educator's own
    const basis = m.basis.get(target);
    if (!basis) continue; // its marking isn't complete, so it can't be drafted or recorded yet
    const draft = drafts.find((d) => targetOf(d.criterion_id) === target && d.drafted_from === basis);
    if (!draft) continue; // no draft of it made on the marking as it is now
    const why: string[] = [];
    let flags: Flag[];
    if (target === OVERALL) flags = checkOverallFeedback(draft.text, m.overall ? percentOfOverall(m.overall) : null, praise);
    else {
      const c = m.rubric.criteria.find((x) => x.id === target)!;
      const e = m.entries.get(target);
      flags = e ? checkCriterionFeedback(draft.text, c, e.level_id, entryMark(c, e), praise) : checkFeedback(draft.text, null, null, praise, { awarded: null, others: [], nextStep: praise.nextStep !== false });
    }
    for (const f of flags) if (blocks(target === OVERALL, f)) why.push(f.message); // a warning on a criterion shows when the piece is opened, and holds nothing back
    if (target === OVERALL && outliers.get(target)?.has(id)) why.push("the cohort checks flag it: much shorter or longer than the rest at its level, or nearly the same as another student's");
    if (why.length) held.push({ target, title, why });
    else pieces.push({ target, title, draftId: draft.id, text: draft.text });
  }
  if (!pieces.length) {
    if (held.length) return { ...no(`${held.length === 1 ? "its one draft is" : `all ${held.length} of its drafts are`} flagged, so ${held.length === 1 ? "it is" : "they are"} held back for you to record by hand (the reasons are under Checks across the cohort)`), held };
    return no("no draft is waiting to be recorded (recorded already, not drafted yet, or drafted from other marking than there is now)");
  }
  const digest = sha256Text(JSON.stringify([pieces.map((p) => [p.target, p.draftId, sha256Text(p.text)]), held.map((h) => h.target)]));
  return { id, label, mark: m.overall?.mark ?? null, pieces, held, digest };
}

/** Every submission of the cohort with a draft that can be recorded, in order, and those with none, with why. */
export async function draftsToRecord(ws: Workspace): Promise<{ ready: DraftedSubmission[]; notListed: NotListed[] }> {
  if (ws.manifest.workspace_type !== "marking") throw new WorkspaceError("only a marking workspace records the AI's drafts of feedback");
  const checks = await checksFor(ws);
  const ready: DraftedSubmission[] = [];
  const notListed: NotListed[] = [];
  for (const s of (await loadCohort(ws)).submissions) {
    const found = await draftedFor(ws, checks, s);
    if ("pieces" in found) ready.push(found);
    else notListed.push(found);
  }
  return { ready, notListed };
}

export interface RecordedDrafts {
  /** The submissions whose drafts were recorded, by ID, and how many pieces in all. */
  recorded: string[];
  pieces: number;
  /** Those that weren't, with why: they changed after the list was shown, or couldn't be recorded. */
  skipped: NotListed[];
  /** Those with no draft to record, with why. */
  notListed: NotListed[];
  /** How many were listed, and how many of them had a flagged piece held back. */
  size: number;
  flagged: number;
}

/**
 * Record the unflagged drafts of every submission listed, as one set. `skimmed` is the educator's confirmation that they skimmed the list, as it showed it: each
 * submission by ID with its digest (null if they haven't confirmed). Without it nothing is recorded; and a submission whose drafts aren't the ones they confirmed
 * is left out, and said. A flagged piece is never recorded here.
 */
export async function recordDrafts(ws: Workspace, options: { skimmed: Record<string, string> | null; now?: Date }): Promise<RecordedDrafts> {
  const { ready, notListed } = await draftsToRecord(ws);
  const flagged = ready.filter((r) => r.held.length).length;
  const result: RecordedDrafts = { recorded: [], pieces: 0, skipped: [], notListed, size: ready.length, flagged };
  if (!ready.length) return result;
  if (options.skimmed === null) throw new WorkspaceError("confirm that you have skimmed the drafts listed, then record them; nothing was recorded");
  const recordedInSet = { size: ready.length, flagged, skimmed: true };
  const checks = await checksFor(ws);
  for (const r of ready) {
    if (options.skimmed[r.id] !== r.digest) {
      result.skipped.push({ id: r.id, label: r.label, why: "its drafts aren't the ones you confirmed you had skimmed (they changed, or it wasn't listed): skim it, and confirm again" });
      continue;
    }
    try {
      // Read again now, at the write: a piece recorded by hand since the list was shown must not be replaced by the old draft, and what is recorded is what was skimmed.
      const now = await draftedFor(ws, checks, { submission_id: r.id, pseudonym: r.label.slice(r.id.length + 1) });
      if (!("pieces" in now)) throw new WorkspaceError(`it changed since the list was shown and can't be recorded now: ${now.why}`);
      if (now.digest !== options.skimmed[r.id]) throw new WorkspaceError("its drafts changed since you confirmed you had skimmed them: skim it, and confirm again");
      for (const p of now.pieces) {
        await recordFeedback(ws, r.id, p.target, { text: p.text, fromDraft: p.draftId, recordedInSet, now: options.now });
        result.pieces += 1;
      }
      result.recorded.push(r.id);
    } catch (err) {
      if (!(err instanceof WorkspaceError)) throw err;
      result.skipped.push({ id: r.id, label: r.label, why: err.message });
    }
  }
  return result;
}
