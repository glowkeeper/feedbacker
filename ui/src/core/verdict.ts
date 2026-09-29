/**
 * The moderator's verdict on how a sampled submission was marked (#19):
 * agree, generous, harsh or inconsistent, with an optional suggested mark and
 * comment. Kept in `verdicts/<id>.json` (private); a change keeps the previous
 * file in a history.
 *
 * A verdict is on the original marking, so it can only be recorded once there
 * is marking to judge and the moderator may see it (never before a blind
 * review's reveal). It records the approved text and a digest of each marking
 * record it was given on (evidence.ts), so it is flagged once either changes.
 * The comment is anonymised with the submissions' tokens.
 */

import { apply, detect, loadRules } from "./anonymise.ts";
import { approvedText } from "./boundary.ts";
import { loadJudgements } from "./judgement.ts";
import { loadRubric, MARKING, markingPath } from "./marking.ts";
import { staleJudgements, verdictInputs } from "./evidence.ts";
import { entryMark, impliedOverall } from "./marks.ts";
import { OriginalAssessment, SubmissionVerdict, type Verdict } from "./models.ts";
import { loadRequest, MODERATOR } from "./request.ts";
import { markingWithheld } from "./reviewState.ts";
import { type Workspace, WorkspaceError } from "./workspace.ts";

export const VERDICTS = "verdicts";
export const verdictPath = (submissionId: string) => `${VERDICTS}/${submissionId}.json`;

export async function loadVerdict(ws: Workspace, submissionId: string): Promise<SubmissionVerdict | null> {
  const path = verdictPath(submissionId);
  if (!(await ws.exists(path))) return null;
  const parsed = SubmissionVerdict.safeParse(await ws.readJson(path));
  if (!parsed.success) throw new WorkspaceError(`${path} is not a valid verdict`);
  if (parsed.data.submission_id !== submissionId) throw new WorkspaceError(`${path} holds the verdict on another submission ('${parsed.data.submission_id}')`);
  return parsed.data;
}

/** The submission's marking records that load: what a verdict is given on. */
async function currentMarking(ws: Workspace, submissionId: string): Promise<OriginalAssessment[]> {
  if (!(await ws.exists(MARKING))) return [];
  const out: OriginalAssessment[] = [];
  for (const e of await ws.fs.list(MARKING)) {
    if (e.kind !== "file" || !e.name.startsWith(`${submissionId}--`) || !e.name.endsWith(".json")) continue;
    const parsed = OriginalAssessment.safeParse(await ws.readJson(`${MARKING}/${e.name}`));
    // Only a record filed where it belongs (its submission and marker), as the review loads it: a misfiled one isn't this submission's marking.
    if (parsed.success && parsed.data.submission_id === submissionId && markingPath(submissionId, parsed.data.marker_label) === `${MARKING}/${e.name}`) out.push(parsed.data);
  }
  return out;
}

/**
 * The overall mark the moderator's current criterion marks imply, or null
 * while it can't be worked out: a criterion unjudged or judged against
 * something since changed, or the rubric without weights.
 */
export async function criteriaMark(ws: Workspace, submissionId: string, approvedSha256: string): Promise<number | null> {
  const rubric = await loadRubric(ws);
  const judgements = await loadJudgements(ws, submissionId);
  if (staleJudgements(judgements, approvedSha256, rubric).length) return null;
  const implied = impliedOverall(rubric.criteria, (c) => {
    const j = judgements.find((x) => x.criterion_id === c.id);
    return j ? entryMark(c, j.revised ?? j.first) : null;
  });
  return "mark" in implied ? implied.mark : null;
}

export interface VerdictInput {
  verdict: Verdict;
  suggestedMark?: number | null;
  comment?: string | null;
  now?: Date;
}

export async function recordVerdict(ws: Workspace, submissionId: string, input: VerdictInput): Promise<SubmissionVerdict> {
  const request = await loadRequest(ws);
  if (!request.sample.some((s) => s.submission_id === submissionId)) throw new WorkspaceError(`${submissionId} is not in the sample`);
  const withheld = await markingWithheld(ws, submissionId);
  if (withheld) throw new WorkspaceError(`a verdict is on the original marking, which isn't shown yet: ${withheld}`);
  const markings = await currentMarking(ws, submissionId);
  if (!markings.length) throw new WorkspaceError(`${submissionId} has no original marking to give a verdict on; import or enter it first`);
  const [, approval] = await approvedText(ws, submissionId);
  const previous = await loadVerdict(ws, submissionId);
  const key = await ws.readKey();
  const rules = await loadRules(ws);
  const text = input.comment?.trim() || null;
  const now = input.now ?? new Date();
  const verdict = SubmissionVerdict.parse({
    submission_id: submissionId,
    verdict: input.verdict,
    suggested_mark: input.suggestedMark ?? null,
    criteria_mark: await criteriaMark(ws, submissionId, approval.approved_text_sha256),
    comment: text && apply(text, detect(text, key, rules), key)[0],
    provenance: {
      source: `submission:${submissionId}`,
      transformation: previous ? "revised" : "recorded",
      actor: MODERATOR,
      timestamp: now.toISOString(),
      input_hashes: verdictInputs(approval.approved_text_sha256, markings), // the text and every marking record it was given on
    },
  });
  let history: string | null = null;
  try {
    await ws.writeKey(key); // anonymising the comment may have added a token
    if (previous) {
      const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.(\d{3})Z$/, "$1000");
      const base = `${VERDICTS}/history/${submissionId}--${stamp}`;
      history = `${base}.json`;
      for (let n = 2; await ws.exists(history); n++) history = `${base}-${n}.json`;
      await ws.writeJson(history, await ws.readJson(verdictPath(submissionId)));
    }
    await ws.writeJson(verdictPath(submissionId), verdict);
  } catch (err) {
    if (history) await ws.fs.remove(history).catch(() => {});
    await ws.secure().catch(() => {});
    throw err;
  }
  await ws.secure();
  return verdict;
}
