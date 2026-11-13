/**
 * Taking the AI's proposed levels for many submissions in one action, by exception (ADR 0016).
 *
 * The educator is responsible for every mark, and the AI never decides. So the proposals are taken only after a list that shows each one, with the criteria
 * that have no proposed level set apart, and after the educator confirms they skimmed it. The confirmation is of each submission's proposals as listed, by
 * digest: one that changed since is left out and named. A criterion with no proposed level is never in the set: it is the educator's to mark.
 *
 * Each mark taken is recorded as it would be on its own (a judgement whose level is taken from the AI's suggestion, and the overall mark the levels imply
 * where every criterion had a proposal), and says it was taken in a set, not one by one. At Export it is skimmed in the list with the rest, as every approval in a set is (approveFeedbackSet.ts);
 * recording the mark again by hand ends the mark.
 */

import { approvedText, UnapprovedText } from "./boundary.ts";
import { loadCohort } from "./cohort.ts";
import { loadGradeScale, proposeOverall } from "./gradeScale.ts";
import { readingProblems } from "./evidence.ts";
import { chooseReviewMode, loadJudgements, recordJudgement } from "./judgement.ts";
import { loadRubric } from "./marking.ts";
import { criterionMax, provisionalMark } from "./marks.ts";
import type { Criterion, Level, Rubric } from "./models.ts";
import { loadReadings, readingPath } from "./reading.ts";
import { loadReviewState } from "./reviewState.ts";
import { loadSubmissionMark, proposedOverall, recordSubmissionMark } from "./submissionMark.ts";
import { sha256Text } from "./text.ts";
import type { Workspace } from "./workspace.ts";
import { WorkspaceError } from "./workspace.ts";

/** The AI's proposed level for one criterion of a submission, as the list shows it. */
export interface ProposedLevel {
  criterionId: string;
  title: string;
  levelId: string;
  levelLabel: string;
  /** The suggestion the level would be taken from. */
  suggestionId: string;
  /** The AI's reasons, as it gave them. */
  rationale: string;
}

/** A level suggested for a criterion the AI proposed none for, from the educator's other criteria: not from the work. */
export interface SuggestedLevel {
  levelId: string;
  levelLabel: string;
  /** How many other criteria it is worked out from, and the share of their maximum they average, as a percentage. */
  from: number;
  averagePercent: number;
}

const levelPoints = (l: Level): number | null => l.points ?? (l.min_mark !== null && l.max_mark !== null ? (l.min_mark + l.max_mark) / 2 : null);

/**
 * A level for criterion `c`, suggested from the levels proposed for the others: they average some share of their maximum marks (weighted by the criteria's weights where
 * the rubric has them), and the level of `c` nearest that share of its own maximum is suggested (the lower of two equally near). Only where at least half the criteria
 * have a proposal and `c` has levels with marks; otherwise there is nothing to suggest from, and none is made. It is an inference, and is never an assessment of the work.
 */
export function suggestFromOthers(rubric: Rubric, c: Criterion, proposed: { criterion: Criterion; level: Level }[]): SuggestedLevel | null {
  const shares = proposed.flatMap(({ criterion, level }) => {
    const points = levelPoints(level);
    const max = criterionMax(criterion);
    return points !== null && max !== null && max > 0 ? [{ share: points / max, weight: criterion.weight ?? 1 }] : [];
  });
  if (shares.length * 2 < rubric.criteria.length || shares.length === 0) return null;
  const weights = shares.reduce((n, s) => n + s.weight, 0);
  const average = weights > 0 ? shares.reduce((n, s) => n + s.share * s.weight, 0) / weights : shares.reduce((n, s) => n + s.share, 0) / shares.length;
  const max = criterionMax(c);
  if (max === null || !(max > 0)) return null;
  const target = average * max;
  const options = c.levels.flatMap((l) => (l.points === null ? [] : [{ level: l, away: Math.abs(l.points! - target), points: l.points! }]));
  if (!options.length) return null;
  options.sort((a, b) => a.away - b.away || a.points - b.points);
  return { levelId: options[0].level.id, levelLabel: options[0].level.label, from: shares.length, averagePercent: Math.round(average * 100) };
}

/** A submission whose proposals can be taken. */
export interface ProposedSubmission {
  id: string;
  label: string;
  /** Every criterion that has a proposed level. */
  proposals: ProposedLevel[];
  /**
   * The criteria with no proposed level (too little evidence, say), which are the educator's to mark: why, the levels to choose from, and a level suggested from the
   * other criteria, if there are enough of them to suggest from. The suggestion is not an assessment of the work, and says so; it is taken only if the educator accepts it.
   */
  left: { criterionId: string; title: string; why: string; levels: { id: string; label: string }[]; suggestion: SuggestedLevel | null }[];
  /** The overall mark the proposed levels imply, when every criterion has one and the rubric can say; null otherwise. */
  provisional: number | null;
  /** The provisional mark worked out from the proposed levels before it is rounded to the workspace's grade scale; the same as `provisional` when nothing is rounded. */
  provisionalWorked: number | null;
  /** Of exactly what would be recorded: what the educator is shown, and what they confirm they skimmed. */
  digest: string;
}

/** A submission that can't be taken now, and why. */
export interface NotTaken {
  id: string;
  label: string;
  why: string;
}

/** One submission's proposals as they can be taken now: the submission, or why not. Read again at the moment of taking, so nothing is taken on a stale list. */
async function proposalFor(ws: Workspace, rubric: Rubric, s: { submission_id: string; pseudonym: string }): Promise<ProposedSubmission | string> {
  const id = s.submission_id;
  const label = `${id} ${s.pseudonym}`;
  let approval;
  try {
    [, approval] = await approvedText(ws, id);
  } catch (err) {
    if (err instanceof UnapprovedText || err instanceof WorkspaceError) {
      return ("its text isn't approved yet");
    }
    throw err;
  }
  if ((await loadJudgements(ws, id)).length || (await loadSubmissionMark(ws, id))) {
    return ("it is marked already");
  }
  if ((await loadReviewState(ws, id))?.mode === "blind") {
    return ("it is being marked blind, so the proposals aren't shown to you before you have marked it");
  }
  if (!(await ws.exists(readingPath(id)))) {
    return ("it has no AI proposal yet");
  }
  let readings;
  try {
    readings = await loadReadings(ws, id);
  } catch (err) {
    if (!(err instanceof WorkspaceError)) throw err;
    return (`its AI proposal can't be read: ${err.message}`);
  }
  if (readingProblems(id, readings, approval.approved_text_sha256, { approvalId: approval.id, rubric, approvedFigures: approval.figures }).length) {
    return ("its AI proposal is out of date (the text, the rubric or the figures changed since): propose again first");
  }
  const proposals: ProposedLevel[] = [];
  const proposed: { criterion: Criterion; level: Level }[] = [];
  const without: { c: Criterion; why: string }[] = [];
  for (const c of rubric.criteria) {
    const suggestion = readings.find((r) => r.criterion_id === c.id);
    const level = suggestion?.suggested_level_id ? c.levels.find((l) => l.id === suggestion.suggested_level_id) : undefined;
    if (suggestion && level && level.points === null && !suggestion.missing_evidence) {
      // A level that is a range needs a mark of the educator's own within it, which the AI didn't give: it can't be taken, and is theirs to mark.
      without.push({ c, why: "the AI proposed a level that is a range, which needs a mark of your own within it" });
    } else if (suggestion && level && !suggestion.missing_evidence) {
      proposals.push({ criterionId: c.id, title: c.title, levelId: level.id, levelLabel: level.label, suggestionId: suggestion.id, rationale: suggestion.rationale });
      proposed.push({ criterion: c, level });
    } else {
      without.push({ c, why: suggestion?.missing_evidence ? "the AI found too little evidence to propose a level" : "the AI proposed no level" });
    }
  }
  if (!proposals.length) {
    // The AI may have given a level for each and flagged it as having too little evidence behind it: that is not "no level", and is said as it is (a submission that is
    // mostly figures that were left out gives it little to go on).
    return (
      without.every((w) => w.why.startsWith("the AI found too little evidence"))
        ? "the AI found too little evidence to propose a level for any criterion (this can happen when a submission is mostly figures that were left out): mark it yourself"
        : "the AI proposed no level for any criterion: mark it yourself"
    );
  }
  // Each criterion with no proposal: the levels to choose from, and a level suggested from the others (an inference, not an assessment of the work).
  const left: ProposedSubmission["left"] = without.map(({ c, why }) => ({
    criterionId: c.id,
    title: c.title,
    why,
    levels: c.levels.filter((l) => l.points !== null).map((l) => ({ id: l.id, label: l.label })), // a range-only level needs a mark of its own, so it can't be chosen here
    suggestion: suggestFromOthers(rubric, c, proposed),
  }));
  const implied = left.length ? null : provisionalMark(rubric.criteria, (cid) => readings.find((r) => r.criterion_id === cid));
  const scale = await loadGradeScale(ws);
  const overall = implied && "mark" in implied ? proposeOverall(implied.mark, scale) : null;
  const provisional = overall?.mark ?? null;
  const provisionalWorked = overall?.worked ?? null;
  // The rubric's marks are in it, so a rubric changed in its points (same IDs) needs another skim.
  const marksOf = (c: Criterion) => [c.id, c.weight ?? null, c.levels.map((l) => [l.id, l.points, l.min_mark, l.max_mark])];
  const digest = sha256Text(
    JSON.stringify([proposals.map((p) => [p.criterionId, p.levelId, p.suggestionId, p.levelLabel, p.rationale]), left.map((l) => [l.criterionId, l.why, l.suggestion?.levelId ?? null]), provisional, provisionalWorked, scale, rubric.criteria.map(marksOf)]),
  );
  return { id, label, proposals, left, provisional, provisionalWorked, digest };
}

/** Every submission of the cohort whose proposals can be taken, in order, and those that can't, with why. */
export async function proposalsToTake(ws: Workspace): Promise<{ ready: ProposedSubmission[]; notTaken: NotTaken[] }> {
  if (ws.manifest.workspace_type !== "marking") throw new WorkspaceError("only a marking workspace takes the AI's proposals as marks");
  const rubric = await loadRubric(ws);
  const ready: ProposedSubmission[] = [];
  const notTaken: NotTaken[] = [];
  for (const s of (await loadCohort(ws)).submissions) {
    const found = await proposalFor(ws, rubric, s);
    if (typeof found === "string") notTaken.push({ id: s.submission_id, label: `${s.submission_id} ${s.pseudonym}`, why: found });
    else ready.push(found);
  }
  return { ready, notTaken };
}

export interface TakenProposals {
  /** The submissions whose proposals were taken, by ID. */
  taken: string[];
  /** Those that weren't, with why: they changed after the list was shown, or couldn't be recorded. */
  skipped: NotTaken[];
  /** Those that couldn't be listed at all, with why (marked already, marked blind, no current proposal). */
  notTaken: NotTaken[];
  /** How many were listed, and how many of them had a criterion left for the educator. */
  size: number;
  flagged: number;
  /** How many criteria with no AI proposal were given a level in the set (accepted as suggested from the other criteria, or chosen by the educator), of those left. */
  filled: { accepted: number; chosen: number };
}

/**
 * Take the proposed levels of every submission listed, as one set. `skimmed` is the educator's confirmation that they skimmed the list, as it showed it: each
 * submission by ID with its digest (null if they haven't confirmed). Without it nothing is taken; and a submission whose proposals aren't the ones they confirmed
 * is left out, and said. Each criterion with a proposed level is recorded taken from it. `filled` is what the educator chose, in the list, for the criteria with no
 * proposal (by submission and criterion, the level's id): a level that is the one suggested from the other criteria is recorded as accepted as suggested, in the set;
 * any other is the educator's own choice, recorded as theirs. A criterion given nothing stays theirs to mark. The overall mark is taken where every criterion has a level.
 */
export async function takeProposals(ws: Workspace, options: { skimmed: Record<string, string> | null; filled?: Record<string, Record<string, string>>; now?: Date }): Promise<TakenProposals> {
  const { ready, notTaken } = await proposalsToTake(ws);
  const flagged = ready.filter((r) => r.left.length).length;
  const result: TakenProposals = { taken: [], skipped: [], notTaken, size: ready.length, flagged, filled: { accepted: 0, chosen: 0 } };
  if (!ready.length) return result;
  if (options.skimmed === null) throw new WorkspaceError("confirm that you have skimmed the proposals listed, then take them; nothing was recorded");
  const takenInSet = { size: ready.length, flagged, skimmed: true };
  const rubric = await loadRubric(ws);
  for (const listed of ready) {
    if (options.skimmed[listed.id] !== listed.digest) {
      result.skipped.push({ id: listed.id, label: listed.label, why: "its proposals aren't the ones you confirmed you had skimmed (they changed, or it wasn't listed): skim it, and confirm again" });
      continue;
    }
    try {
      // Read again now, at the write: another edit since the list was made (a mark of its own, say) must not be overwritten, and what is taken is what was skimmed.
      const r = await proposalFor(ws, rubric, { submission_id: listed.id, pseudonym: listed.label.slice(listed.id.length + 1) });
      if (typeof r === "string") throw new WorkspaceError(`it changed since the list was shown and can't be taken now: ${r}`);
      if (r.digest !== options.skimmed[listed.id]) throw new WorkspaceError("its proposals changed since you confirmed you had skimmed them: skim it, and confirm again");
      // Every level chosen is checked before anything is written, so a bad choice never leaves it half marked.
      for (const l of r.left) {
        const chosen = options.filled?.[r.id]?.[l.criterionId];
        if (chosen && !l.levels.some((x) => x.id === chosen)) throw new WorkspaceError(`'${chosen}' is not a level of ${l.title}; nothing of it was recorded`);
      }
      for (const p of r.proposals) await recordJudgement(ws, r.id, p.criterionId, { levelId: p.levelId, levelFromAi: true, takenInSet, now: options.now });
      let remaining = r.left.length;
      for (const l of r.left) {
        const chosen = options.filled?.[r.id]?.[l.criterionId];
        if (!chosen) continue;
        if (chosen === l.suggestion?.levelId) {
          await recordJudgement(ws, r.id, l.criterionId, { levelId: chosen, levelFromOthers: true, takenInSet, now: options.now });
          result.filled.accepted += 1;
        } else {
          await recordJudgement(ws, r.id, l.criterionId, { levelId: chosen, now: options.now }); // the educator's own choice, in the list: recorded as theirs
          result.filled.chosen += 1;
        }
        remaining -= 1;
      }
      if (!remaining) {
        const [, approval] = await approvedText(ws, r.id);
        const implied = await proposedOverall(ws, r.id, approval.approved_text_sha256);
        if (implied !== null) await recordSubmissionMark(ws, r.id, { mark: implied.mark, takenInSet, now: options.now });
      }
      result.taken.push(r.id);
    } catch (err) {
      if (!(err instanceof WorkspaceError)) throw err;
      result.skipped.push({ id: listed.id, label: listed.label, why: err.message });
    }
  }
  return result;
}

/**
 * The educator chooses to see the AI's proposals for the cohort: each submission listed is from now on reviewed openly, saved so that it holds after leaving the
 * screen or reloading, because a proposal seen can't be unseen and the submission can't then be marked blind. Returns how many were set. A submission already being
 * marked blind is not listed, and is left as it is.
 */
export async function showProposals(ws: Workspace, now?: Date): Promise<number> {
  const { ready } = await proposalsToTake(ws);
  for (const r of ready) await chooseReviewMode(ws, r.id, "open", now);
  return ready.length;
}
