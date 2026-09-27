/**
 * The moderator's own judgements (#19): a level per criterion of the source
 * rubric, with an optional comment, recorded in the mode it was made in.
 *
 * Each sampled submission's judgements are kept in `judgements/<id>.json`, one
 * per criterion. A judgement is made while reading the approved anonymised
 * text, so it can only be recorded once that text is approved, and it records
 * the approved text's hash. Comments are anonymised with the same tokens as
 * the submissions (new tokens are saved in the key). Every change keeps the
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
import { criterionOf, ModeratorJudgement, OriginalAssessment, ReviewMode, Timestamp } from "./models.ts";
import { loadRequest, MODERATOR } from "./request.ts";
import { type Workspace, WorkspaceError } from "./workspace.ts";

export const JUDGEMENTS = "judgements";
export const judgementPath = (submissionId: string) => `${JUDGEMENTS}/${submissionId}.json`;
export const reviewStatePath = (submissionId: string) => `${JUDGEMENTS}/${submissionId}--review.json`;

/** How a submission is being reviewed, and when a blind review was revealed. */
export const ReviewState = z.strictObject({
  submission_id: z.string(), // checked against the submission it is loaded for
  mode: ReviewMode,
  chosen_at: Timestamp,
  revealed_at: Timestamp.nullable().default(null),
});
export type ReviewState = z.output<typeof ReviewState>;

/** Whether what the moderator must not see yet (the original marking, the AI reading) is hidden. */
export const isHidden = (state: ReviewState | null) => state?.mode === "blind" && state.revealed_at === null;

export async function loadReviewState(ws: Workspace, submissionId: string): Promise<ReviewState | null> {
  const path = reviewStatePath(submissionId);
  if (!(await ws.exists(path))) return null;
  const parsed = ReviewState.safeParse(await ws.readJson(path));
  if (!parsed.success) throw new WorkspaceError(`${path} is not a valid review record`);
  if (parsed.data.submission_id !== submissionId) throw new WorkspaceError(`${path} records the review of another submission ('${parsed.data.submission_id}')`);
  return parsed.data;
}

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

async function inSample(ws: Workspace, submissionId: string) {
  const request = await loadRequest(ws);
  if (!request.sample.some((s) => s.submission_id === submissionId)) throw new WorkspaceError(`${submissionId} is not in the sample`);
}

/** Whether any of the submission's marking has been confirmed (or entered), and so seen by the moderator. */
async function markingSeen(ws: Workspace, submissionId: string): Promise<boolean> {
  if (!(await ws.exists(MARKING))) return false;
  for (const e of await ws.fs.list(MARKING)) {
    if (e.kind !== "file" || !e.name.startsWith(`${submissionId}--`) || !e.name.endsWith(".json")) continue;
    const parsed = OriginalAssessment.safeParse(await ws.readJson(`${MARKING}/${e.name}`));
    if (!parsed.success || parsed.data.confirmed_at !== null) return true; // one that doesn't load may have been seen
  }
  return false;
}

/** Choose how a submission is reviewed. The choice is kept; it can't be changed afterwards. */
export async function chooseReviewMode(ws: Workspace, submissionId: string, mode: ReviewMode, now?: Date): Promise<ReviewState> {
  await inSample(ws, submissionId);
  const current = await loadReviewState(ws, submissionId);
  if (current) {
    if (current.mode === mode) return current;
    throw new WorkspaceError(`${submissionId} is already being reviewed ${current.mode}; the choice can't be changed`);
  }
  if (mode === "blind") {
    if ((await loadJudgements(ws, submissionId)).length) throw new WorkspaceError(`${submissionId} already has open judgements, so it can't be reviewed blind`);
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
  comment?: string | null;
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
  const criterion = criterionOf(await loadRubric(ws), criterionId);
  if (!criterion) throw new WorkspaceError(`'${criterionId}' is not a criterion of the source rubric`);
  if (!criterion.levels.some((l) => l.id === entry.levelId)) {
    throw new WorkspaceError(`'${entry.levelId}' is not a level of criterion '${criterionId}'`);
  }
  const [, approval] = await approvedText(ws, submissionId); // a judgement is of the approved text
  const state = (await loadReviewState(ws, submissionId)) ?? (await chooseReviewMode(ws, submissionId, "open", entry.now));
  const existing = await loadJudgements(ws, submissionId);
  const previous = existing.find((j) => j.criterion_id === criterionId);
  const key = await ws.readKey();
  const rules = await loadRules(ws);
  const text = entry.comment?.trim() || null;
  const comment = text && apply(text, detect(text, key, rules), key)[0];
  const now = entry.now ?? new Date();
  const at = now.toISOString();
  const recorded = { level_id: entry.levelId, comment, comment_derived_from_ai: false, recorded_at: at };
  const provenance = (transformation: "recorded" | "revised") => ({
    source: `submission:${submissionId}`,
    transformation,
    actor: MODERATOR,
    timestamp: at,
    input_hashes: [approval.approved_text_sha256],
  });
  let judgement: ModeratorJudgement;
  if (state.mode === "blind" && state.revealed_at !== null) {
    if (!previous) throw new WorkspaceError(`${submissionId}/${criterionId} has no first judgement to revise`);
    // The first judgement, its provenance and the reveal are kept; only the revision is new.
    judgement = ModeratorJudgement.parse({ ...previous, revised: recorded });
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
  const judged = new Set(judgements.map((j) => j.criterion_id));
  const missing = (await loadRubric(ws)).criteria.filter((c) => !judged.has(c.id)).map((c) => c.title);
  if (missing.length) throw new WorkspaceError(`record a level for every criterion before the reveal; still to judge: ${missing.join(", ")}`);
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
