/**
 * The educator's overall mark and comment for a submission they mark, kept in
 * `judgements/<id>--mark.json` (private) beside their criterion judgements; a
 * change keeps the previous file in a history.
 *
 * The overall mark starts from the mark the criterion marks imply, and the
 * educator may change it. The implied mark at the time is recorded beside it,
 * and so (in its provenance) are the approved text, the rubric and every
 * criterion's level and mark it was given on (evidence.ts), so any later
 * change to them flags the overall mark for a second look. The comment is anonymised with the submissions' tokens.
 */

import { redactor } from "./anonymise.ts";
import { EDUCATOR } from "./assessment.ts";
import { approvedText } from "./boundary.ts";
import { staleSubmissionMark, submissionMarkInputs } from "./evidence.ts";
import { isDefault, loadGradeScale, proposeOverall, type ProposedOverall } from "./gradeScale.ts";
import { inSample, loadJudgements } from "./judgement.ts";
import { loadRubric } from "./marking.ts";
import { SubmissionMark, type TakenInSet } from "./models.ts";
import { JUDGEMENTS } from "./reviewState.ts";
import { criteriaMark } from "./verdict.ts";
import { type Workspace, WorkspaceError } from "./workspace.ts";

export const submissionMarkPath = (submissionId: string) => `${JUDGEMENTS}/${submissionId}--mark.json`;

export async function loadSubmissionMark(ws: Workspace, submissionId: string): Promise<SubmissionMark | null> {
  const path = submissionMarkPath(submissionId);
  if (!(await ws.exists(path))) return null;
  const parsed = SubmissionMark.safeParse(await ws.readJson(path));
  if (!parsed.success) throw new WorkspaceError(`${path} is not a valid overall mark`);
  if (parsed.data.submission_id !== submissionId) throw new WorkspaceError(`${path} holds the mark of another submission ('${parsed.data.submission_id}')`);
  return parsed.data;
}

/** Whether the overall mark was given on another approved text, another rubric, or other criterion levels and marks than there are now. */
export async function submissionMarkStale(ws: Workspace, mark: SubmissionMark): Promise<boolean> {
  const [, approval] = await approvedText(ws, mark.submission_id);
  return staleSubmissionMark(mark, approval.approved_text_sha256, await loadRubric(ws), await loadJudgements(ws, mark.submission_id));
}

/**
 * The overall mark the educator's criterion marks propose, on the workspace's scale: the mark worked out from the criteria, and that rounded to the scale's
 * grade points (the same figure when nothing is rounded). Null while it can't be worked out.
 */
export async function proposedOverall(ws: Workspace, submissionId: string, approvedSha256: string): Promise<ProposedOverall | null> {
  const percentage = await criteriaMark(ws, submissionId, approvedSha256);
  return percentage === null ? null : proposeOverall(percentage, await loadGradeScale(ws));
}

export async function recordSubmissionMark(ws: Workspace, submissionId: string, input: { mark: number; comment?: string | null; takenInSet?: TakenInSet; now?: Date }): Promise<SubmissionMark> {
  if (ws.manifest.workspace_type !== "marking") throw new WorkspaceError("only a marking workspace records the educator's overall marks");
  await inSample(ws, submissionId);
  const scale = await loadGradeScale(ws);
  if (!Number.isFinite(input.mark) || input.mark < 0) throw new WorkspaceError("the overall mark must be a number, 0 or more");
  if (input.mark > scale.out_of) throw new WorkspaceError(`the overall mark is out of ${scale.out_of}, so ${input.mark} is too high`);
  const [, approval] = await approvedText(ws, submissionId); // a mark is of the approved text
  const previous = await loadSubmissionMark(ws, submissionId);
  const redact = await redactor(ws);
  const text = input.comment?.trim() || null;
  const now = input.now ?? new Date();
  const record = SubmissionMark.parse({
    submission_id: submissionId,
    mark: input.mark,
    criteria_mark: (await proposedOverall(ws, submissionId, approval.approved_text_sha256))?.worked ?? null, // before any rounding
    grade_scale: isDefault(scale) ? null : scale,
    taken_in_set: input.takenInSet ?? null, // taken as the mark the proposed levels imply, with others, unopened; recording it again by hand ends that
    comment: redact.text(text),
    provenance: {
      source: `submission:${submissionId}`,
      transformation: previous ? "revised" : "recorded",
      actor: EDUCATOR,
      timestamp: now.toISOString(),
      input_hashes: submissionMarkInputs(approval.approved_text_sha256, await loadRubric(ws), await loadJudgements(ws, submissionId)), // what it is given on
    },
  });
  let history: string | null = null;
  try {
    await redact.keep();
    if (previous) {
      const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.(\d{3})Z$/, "$1000");
      const base = `${JUDGEMENTS}/history/${submissionId}--mark--${stamp}`;
      history = `${base}.json`;
      for (let n = 2; await ws.exists(history); n++) history = `${base}-${n}.json`;
      await ws.writeJson(history, await ws.readJson(submissionMarkPath(submissionId)));
    }
    await ws.writeJson(submissionMarkPath(submissionId), record);
  } catch (err) {
    if (history) await ws.fs.remove(history).catch(() => {});
    await ws.secure().catch(() => {});
    throw err;
  }
  await ws.secure(); // private, as the judgements are
  return record;
}
