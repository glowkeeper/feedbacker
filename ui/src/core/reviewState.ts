/**
 * How a sampled submission is being reviewed: open, or blind until the
 * reveal. Kept in `judgements/<id>--review.json` and read by everything that
 * could show the original marking, so blind review is kept blind in the core,
 * not only on screen.
 *
 * When the mode can't be established (a damaged record, or judgements that
 * don't match it), the marking and the AI reading stay hidden: it fails
 * closed.
 */

import * as z from "zod";
import { ModeratorJudgement, ReviewMode, Timestamp } from "./models.ts";
import { type Workspace, WorkspaceError } from "./workspace.ts";

export const JUDGEMENTS = "judgements";
export const judgementPath = (submissionId: string) => `${JUDGEMENTS}/${submissionId}.json`;
export const reviewStatePath = (submissionId: string) => `${JUDGEMENTS}/${submissionId}--review.json`;

/** How a submission is being reviewed, and when a blind review was revealed. */
export const ReviewState = z
  .strictObject({
    submission_id: z.string(), // checked against the submission it is loaded for
    mode: ReviewMode,
    chosen_at: Timestamp,
    revealed_at: Timestamp.nullable().default(null),
  })
  .refine((s) => s.mode === "blind" || s.revealed_at === null, "an open review has no reveal");
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

/**
 * The submission's review as it stands: its record, or, for judgements
 * recorded before the choice was kept, open review, but only once those
 * judgements are read and all open. Null when no choice has been made.
 * Throws when it can't be established.
 */
export async function currentReview(ws: Workspace, submissionId: string): Promise<{ mode: ReviewMode; revealed_at: string | null } | null> {
  const state = await loadReviewState(ws, submissionId);
  if (state) return state;
  const path = judgementPath(submissionId);
  if (!(await ws.exists(path))) return null;
  const parsed = z.array(ModeratorJudgement).safeParse(await ws.readJson(path));
  if (!parsed.success) throw new WorkspaceError(`${path} is not a valid set of judgements`);
  if (parsed.data.some((j) => j.mode !== "open")) throw new WorkspaceError(`${path} holds blind judgements, but ${reviewStatePath(submissionId)} is missing`);
  return { mode: "open", revealed_at: null };
}

/**
 * Why the submission's original marking must not be shown yet, or null if it
 * may be: it is reviewed blind and not yet revealed, or its review can't be
 * read (so it is kept hidden).
 */
export async function markingWithheld(ws: Workspace, submissionId: string): Promise<string | null> {
  let review;
  try {
    review = await currentReview(ws, submissionId);
  } catch (err) {
    return `${submissionId}'s review can't be read (${err instanceof Error ? err.message : String(err)}), so its marking stays hidden`;
  }
  return review?.mode === "blind" && review.revealed_at === null
    ? `${submissionId} is being reviewed blind: check, confirm or enter its marking after the reveal`
    : null;
}
