/**
 * The moderator's own judgements (or, in a marking workspace, the educator's
 * marks): a level per criterion of the source rubric, with an optional
 * comment, recorded in the mode it was made in. In a marking workspace, "the
 * AI reading" below is the AI's proposals, and there is no original marking.
 *
 * Each sampled submission's judgements are kept in `judgements/<id>.json`, one
 * per criterion. A judgement is made while reading the approved anonymised
 * text against the source rubric, so it can only be recorded once that text
 * is approved, and it records both (evidence.ts): a judgement made against an
 * earlier text or rubric is flagged, and doesn't count towards a blind reveal. Comments are anonymised with the same tokens as
 * the submissions (new tokens are saved in the key). A comment adapted from
 * the AI reading's draft is marked as derived from it. Every change keeps the
 * previous file in a history. There is no Python equivalent: the Python core
 * stopped short of recording judgements.
 *
 * How a submission is reviewed is chosen once, before anything is shown, and
 * kept in `judgements/<id>--review.json`:
 *
 * - **Open** (the default): the original marking and the AI reading are shown
 *   throughout, and each judgement has only a `first` entry, which may be
 *   changed.
 * - **Blind**: they stay hidden until the moderator has recorded a level for
 *   every criterion and reveals them, in one action. Before the reveal, a
 *   first judgement may still be changed; after it, it is kept, and a
 *   `revised` entry may be recorded beside it. Blind review can't be chosen
 *   once the submission's marking has been confirmed (the moderator has seen
 *   it), nor once an open judgement is recorded.
 */

import * as z from "zod";
import { apply, detect, loadRules } from "./anonymise.ts";
import { approvedText } from "./boundary.ts";
import { loadRubric, MARKING } from "./marking.ts";
import { loadReadings, readingPath } from "./reading.ts";
import { judgementInputs, readingProblems, staleJudgements } from "./evidence.ts";
import { markProblem, takesMark } from "./marks.ts";
import { criterionOf, ModeratorJudgement, OriginalAssessment, type ReviewMode } from "./models.ts";
import { ownerOf } from "./assessment.ts";
import { listSubmissions, submissionsName } from "./cohort.ts";
import { currentReview, JUDGEMENTS, judgementPath, loadReviewState, ReviewState, reviewStatePath } from "./reviewState.ts";
import { type Workspace, WorkspaceError } from "./workspace.ts";

/** A submission's recorded judgements, in order of recording; none if nothing is recorded. */
export async function loadJudgements(ws: Workspace, submissionId: string): Promise<ModeratorJudgement[]> {
  const path = judgementPath(submissionId);
  if (!(await ws.exists(path))) return [];
  const parsed = z.array(ModeratorJudgement).safeParse(await ws.readJson(path)); // the workspace reports a file that isn't JSON
  if (!parsed.success) throw new WorkspaceError(`${path} is not a valid set of judgements`);
  const seen = new Set<string>();
  for (const j of parsed.data) {
    if (j.submission_id !== submissionId) throw new WorkspaceError(`${path} holds a judgement of another submission ('${j.submission_id}')`);
    if (seen.has(j.criterion_id)) throw new WorkspaceError(`${path} has two judgements of criterion '${j.criterion_id}'`);
    seen.add(j.criterion_id);
  }
  if (parsed.data.length) {
    // Every judgement is in the mode the review was chosen in, so what the moderator had seen is never misstated.
    const state = await loadReviewState(ws, submissionId);
    const mode = state?.mode ?? "open"; // judgements recorded before the choice was kept were open
    const other = parsed.data.find((j) => j.mode !== mode);
    if (other) throw new WorkspaceError(`${path}: the judgement of '${other.criterion_id}' was made ${other.mode}, but the submission is reviewed ${mode}`);
    if (mode === "blind" && parsed.data.some((j) => j.revealed_at !== state!.revealed_at)) {
      throw new WorkspaceError(`${path}: a judgement's reveal doesn't match the submission's`);
    }
    // A judgement must still fit the source rubric: a stale or damaged one is reported, never counted.
    const rubric = await loadRubric(ws);
    for (const j of parsed.data) {
      const criterion = criterionOf(rubric, j.criterion_id);
      if (!criterion) throw new WorkspaceError(`${path}: '${j.criterion_id}' is not a criterion of the source rubric`);
      for (const entry of [j.first, j.revised]) {
        if (entry && !criterion.levels.some((l) => l.id === entry.level_id)) {
          throw new WorkspaceError(`${path}: '${entry.level_id}' is not a level of criterion '${j.criterion_id}'`);
        }
      }
    }
  }
  return parsed.data;
}

/** The submission is one of the workspace's: in a moderation's sample, or a marking cohort. */
export async function inSample(ws: Workspace, submissionId: string) {
  if (!(await listSubmissions(ws)).some((s) => s.submission_id === submissionId)) throw new WorkspaceError(`${submissionId} is not in ${submissionsName(ws)}`);
}

/** Whether any of the submission's marking has been confirmed (or entered), and so seen by the moderator. */
async function markingSeen(ws: Workspace, submissionId: string): Promise<boolean> {
  if (!(await ws.exists(MARKING))) return false;
  for (const e of await ws.fs.list(MARKING)) {
    if (e.kind !== "file" || !e.name.startsWith(`${submissionId}--`) || !e.name.endsWith(".json")) continue;
    const parsed = OriginalAssessment.safeParse(await ws.readJson(`${MARKING}/${e.name}`));
    // One that doesn't load, or is filed under the wrong submission, may have been seen.
    if (!parsed.success || parsed.data.submission_id !== submissionId || parsed.data.confirmed_at !== null) return true;
  }
  return false;
}

/** Choose how a submission is reviewed. The choice is kept; it can't be changed afterwards. */
export async function chooseReviewMode(ws: Workspace, submissionId: string, mode: ReviewMode, now?: Date): Promise<ReviewState> {
  await inSample(ws, submissionId);
  const kept = await loadReviewState(ws, submissionId);
  if (kept) {
    if (kept.mode === mode) return kept;
    throw new WorkspaceError(`${submissionId} is already being reviewed ${kept.mode}; the choice can't be changed`);
  }
  // Judgements recorded before the choice was kept are open, once they are read and found to be (it fails otherwise).
  if ((await currentReview(ws, submissionId)) && mode === "blind") {
    throw new WorkspaceError(`${submissionId} already has open judgements, so it can't be reviewed blind`);
  }
  if (mode === "blind") {
    if (await markingSeen(ws, submissionId)) {
      throw new WorkspaceError(`${submissionId}'s original marking has already been confirmed (so you have seen it), or a record of it can't be read; it can't be reviewed blind`);
    }
  }
  const state = ReviewState.parse({ submission_id: submissionId, mode, chosen_at: (now ?? new Date()).toISOString() });
  await ws.writeJson(reviewStatePath(submissionId), state, { private: true });
  return state;
}

export interface JudgementEntryInput {
  levelId: string;
  /** The mark within the level; the level's points when left out. */
  mark?: number | null;
  comment?: string | null;
  /** The comment was written from the AI reading's draft for this criterion (it is marked as derived from it). */
  derivedFromAi?: boolean;
  /** The level was taken, unchanged, from the AI reading's suggested level for this criterion. */
  levelFromAi?: boolean;
  now?: Date;
}

/**
 * Record the moderator's judgement of one criterion, in the submission's
 * review mode: open (chosen here if nothing was chosen), blind before the
 * reveal (the first judgement), or blind after it (a revision, beside the
 * first).
 */
export async function recordJudgement(ws: Workspace, submissionId: string, criterionId: string, entry: JudgementEntryInput): Promise<ModeratorJudgement> {
  await inSample(ws, submissionId);
  const rubric = await loadRubric(ws);
  const criterion = criterionOf(rubric, criterionId);
  if (!criterion) throw new WorkspaceError(`'${criterionId}' is not a criterion of the source rubric`);
  const level = criterion.levels.find((l) => l.id === entry.levelId);
  if (!level) throw new WorkspaceError(`'${entry.levelId}' is not a level of criterion '${criterionId}'`);
  const mark = entry.mark ?? level.points; // a level without points or a range, and no mark given, has no mark
  if (mark === null && takesMark(level)) {
    throw new WorkspaceError(`enter your mark for ${criterion.title}: ${level.label} has a mark range (${level.min_mark ?? "any"} to ${level.max_mark ?? "any"}) but no default points`);
  }
  if (mark !== null) {
    const problem = markProblem(criterion, level, mark);
    if (problem) throw new WorkspaceError(problem);
  }
  const [, approval] = await approvedText(ws, submissionId); // a judgement is of the approved text
  const state = (await loadReviewState(ws, submissionId)) ?? (await chooseReviewMode(ws, submissionId, "open", entry.now)); // fails if the review can't be established
  const existing = await loadJudgements(ws, submissionId);
  const previous = existing.find((j) => j.criterion_id === criterionId);
  const key = await ws.readKey();
  const rules = await loadRules(ws);
  const text = entry.comment?.trim() || null;
  const comment = text && apply(text, detect(text, key, rules), key)[0];
  const now = entry.now ?? new Date();
  const at = now.toISOString();
  const derived = Boolean(entry.derivedFromAi && comment);
  let levelFrom: string | null = null;
  if (derived || entry.levelFromAi) {
    // Only a reading the moderator could see: never before a blind review's reveal.
    if (state.mode === "blind" && state.revealed_at === null) throw new WorkspaceError("the AI reading isn't shown before the reveal, so nothing can be taken from it");
    // Only a reading the review shows: of the text as approved now, under this approval, against the rubric as it is now.
    const readings = (await ws.exists(readingPath(submissionId))) ? await loadReadings(ws, submissionId) : [];
    const shown = readingProblems(submissionId, readings, approval.approved_text_sha256, { approvalId: approval.id, rubric }).length === 0;
    const suggestion = shown ? readings.find((r) => r.criterion_id === criterionId) : undefined;
    if (derived && !suggestion?.draft_comment?.trim()) throw new WorkspaceError(`there is no AI draft comment for ${submissionId}/${criterionId} to adapt`);
    if (entry.levelFromAi) {
      if (suggestion?.suggested_level_id !== entry.levelId) {
        throw new WorkspaceError(`the AI reading of ${submissionId}/${criterionId} doesn't suggest '${entry.levelId}', so the level can't be recorded as taken from it`);
      }
      levelFrom = suggestion.id; // bound to this suggestion: a later reading doesn't inherit it
    }
  }
  const recorded = { level_id: entry.levelId, mark, comment, comment_derived_from_ai: derived, level_from_suggestion: levelFrom, recorded_at: at };
  const provenance = (transformation: "recorded" | "revised") => ({
    source: `submission:${submissionId}`,
    transformation,
    actor: ownerOf(ws), // the moderator, or the educator marking
    timestamp: at,
    input_hashes: judgementInputs(approval.approved_text_sha256, rubric), // the text and the rubric it was made against
  });
  let judgement: ModeratorJudgement;
  if (state.mode === "blind" && state.revealed_at !== null) {
    if (!previous) throw new WorkspaceError(`${submissionId}/${criterionId} has no first judgement to revise`);
    // The first judgement, its provenance and the reveal are kept; the revision records what it was made against.
    judgement = ModeratorJudgement.parse({ ...previous, revised: recorded, revised_provenance: provenance("revised") });
  } else {
    judgement = ModeratorJudgement.parse({
      submission_id: submissionId,
      criterion_id: criterionId,
      mode: state.mode,
      first: recorded,
      provenance: provenance(previous ? "revised" : "recorded"),
    });
  }
  const updated = previous ? existing.map((j) => (j === previous ? judgement : j)) : [...existing, judgement];
  await save(ws, submissionId, updated, previous !== undefined, now, async () => ws.writeKey(key)); // anonymising the comment may have added a token
  return judgement;
}

/**
 * Reveal the original marking and the AI reading of a blind review, once a
 * level is recorded for every criterion. The reveal is recorded on the review
 * and on every judgement.
 */
export async function reveal(ws: Workspace, submissionId: string, now?: Date): Promise<ReviewState> {
  await inSample(ws, submissionId);
  const state = await loadReviewState(ws, submissionId);
  if (state?.mode !== "blind") throw new WorkspaceError(`${submissionId} isn't being reviewed blind`);
  if (state.revealed_at !== null) return state;
  const judgements = await loadJudgements(ws, submissionId);
  const rubric = await loadRubric(ws);
  const [, approval] = await approvedText(ws, submissionId);
  // Every criterion judged, and judged on the text approved now and the rubric as it is now.
  const stale = new Set(staleJudgements(judgements, approval.approved_text_sha256, rubric));
  const judged = new Set(judgements.map((j) => j.criterion_id).filter((c) => !stale.has(c)));
  const missing = rubric.criteria.filter((c) => !judged.has(c.id) && !stale.has(c.id)).map((c) => c.title);
  const again = rubric.criteria.filter((c) => stale.has(c.id)).map((c) => c.title);
  const problems = [
    missing.length ? `still to judge: ${missing.join(", ")}` : "",
    again.length ? `to judge again (judged against an earlier approved text or rubric): ${again.join(", ")}` : "",
  ].filter(Boolean);
  if (problems.length) throw new WorkspaceError(`record a level for every criterion before the reveal; ${problems.join("; ")}`);
  const when = now ?? new Date();
  const at = when.toISOString();
  const revealed = ReviewState.parse({ ...state, revealed_at: at });
  const updated = judgements.map((j) => ModeratorJudgement.parse({ ...j, revealed_at: at }));
  // The judgements first: if the review record then fails, the reveal hasn't happened, and the judgements are restored.
  await save(ws, submissionId, updated, true, when, async () => {});
  try {
    await ws.writeJson(reviewStatePath(submissionId), revealed, { private: true });
  } catch (err) {
    await ws.writeJson(judgementPath(submissionId), judgements).catch(() => {});
    await ws.secure().catch(() => {});
    throw err;
  }
  return revealed;
}

async function save(ws: Workspace, submissionId: string, judgements: ModeratorJudgement[], replacing: boolean, when: Date, before: () => Promise<void>) {
  let history: string | null = null;
  try {
    await before();
    if (replacing) history = await archive(ws, submissionId, when);
    await ws.writeJson(judgementPath(submissionId), judgements);
  } catch (err) {
    if (history) await ws.fs.remove(history).catch(() => {});
    await ws.secure().catch(() => {});
    throw err;
  }
  await ws.secure(); // judgements are private, as the marking is
}

async function archive(ws: Workspace, submissionId: string, when: Date): Promise<string> {
  const stamp = when.toISOString().replace(/[-:]/g, "").replace(/\.(\d{3})Z$/, "$1000");
  const base = `${JUDGEMENTS}/history/${submissionId}--${stamp}`;
  let history = `${base}.json`;
  for (let n = 2; await ws.exists(history); n++) history = `${base}-${n}.json`;
  await ws.writeJson(history, await ws.readJson(judgementPath(submissionId)));
  return history;
}
