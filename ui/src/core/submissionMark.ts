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

import { apply, detect, loadRules } from "./anonymise.ts";
import { EDUCATOR } from "./assessment.ts";
import { approvedText } from "./boundary.ts";
import { staleSubmissionMark, submissionMarkInputs } from "./evidence.ts";
import { inSample, loadJudgements } from "./judgement.ts";
import { loadRubric } from "./marking.ts";
import { SubmissionMark } from "./models.ts";
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

export async function recordSubmissionMark(ws: Workspace, submissionId: string, input: { mark: number; comment?: string | null; now?: Date }): Promise<SubmissionMark> {
  if (ws.manifest.workspace_type !== "marking") throw new WorkspaceError("only a marking workspace records the educator's overall marks");
  await inSample(ws, submissionId);
  if (!Number.isFinite(input.mark) || input.mark < 0) throw new WorkspaceError("the overall mark must be a number, 0 or more");
  const [, approval] = await approvedText(ws, submissionId); // a mark is of the approved text
  const previous = await loadSubmissionMark(ws, submissionId);
  const key = await ws.readKey();
  const rules = await loadRules(ws);
  const text = input.comment?.trim() || null;
  const now = input.now ?? new Date();
  const record = SubmissionMark.parse({
    submission_id: submissionId,
    mark: input.mark,
    criteria_mark: await criteriaMark(ws, submissionId, approval.approved_text_sha256),
    comment: text && apply(text, detect(text, key, rules), key)[0],
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
    await ws.writeKey(key); // anonymising the comment may have added a token
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
