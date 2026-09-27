/**
 * The moderator's own judgements (#19): a level per criterion of the source
 * rubric, with an optional comment, recorded in the mode it was made in.
 *
 * Each sampled submission's judgements are kept in `judgements/<id>.json`, one
 * per criterion. A judgement is made while reading the approved anonymised
 * text, so it can only be recorded once that text is approved, and it records
 * the approved text's hash. Comments are anonymised with the same tokens as
 * the submissions (new tokens are saved in the key). Changing an open judgement replaces it, keeping the
 * previous file in a history. There is no Python equivalent: the Python core
 * stopped short of recording judgements.
 */

import * as z from "zod";
import { apply, detect, loadRules } from "./anonymise.ts";
import { approvedText } from "./boundary.ts";
import { loadRubric } from "./marking.ts";
import { criterionOf, ModeratorJudgement } from "./models.ts";
import { loadRequest, MODERATOR } from "./request.ts";
import { type Workspace, WorkspaceError } from "./workspace.ts";

export const JUDGEMENTS = "judgements";
export const judgementPath = (submissionId: string) => `${JUDGEMENTS}/${submissionId}.json`;

/** A submission's recorded judgements, in rubric order of recording; none if nothing is recorded. */
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

export interface JudgementEntryInput {
  levelId: string;
  comment?: string | null;
  now?: Date;
}

/** Record (or change) the moderator's open-review judgement of one criterion. */
export async function recordJudgement(ws: Workspace, submissionId: string, criterionId: string, entry: JudgementEntryInput): Promise<ModeratorJudgement> {
  const request = await loadRequest(ws);
  if (!request.sample.some((s) => s.submission_id === submissionId)) throw new WorkspaceError(`${submissionId} is not in the sample`);
  const criterion = criterionOf(await loadRubric(ws), criterionId);
  if (!criterion) throw new WorkspaceError(`'${criterionId}' is not a criterion of the source rubric`);
  if (!criterion.levels.some((l) => l.id === entry.levelId)) {
    throw new WorkspaceError(`'${entry.levelId}' is not a level of criterion '${criterionId}'`);
  }
  const [, approval] = await approvedText(ws, submissionId); // a judgement is of the approved text
  const existing = await loadJudgements(ws, submissionId);
  const previous = existing.find((j) => j.criterion_id === criterionId);
  if (previous && previous.mode !== "open") {
    throw new WorkspaceError(`the judgement of ${submissionId}/${criterionId} was made blind; it can only be revised after the reveal`);
  }
  const key = await ws.readKey();
  const rules = await loadRules(ws);
  const text = entry.comment?.trim() || null;
  const comment = text && apply(text, detect(text, key, rules), key)[0];
  const at = (entry.now ?? new Date()).toISOString();
  const judgement = ModeratorJudgement.parse({
    submission_id: submissionId,
    criterion_id: criterionId,
    mode: "open",
    first: { level_id: entry.levelId, comment, comment_derived_from_ai: false, recorded_at: at },
    provenance: {
      source: `submission:${submissionId}`,
      transformation: previous ? "revised" : "recorded",
      actor: MODERATOR,
      timestamp: at,
      input_hashes: [approval.approved_text_sha256],
    },
  });
  const updated = previous ? existing.map((j) => (j === previous ? judgement : j)) : [...existing, judgement];
  let history: string | null = null;
  try {
    await ws.writeKey(key); // anonymising the comment may have added a token
    if (previous) history = await archive(ws, submissionId, entry.now ?? new Date());
    await ws.writeJson(judgementPath(submissionId), updated);
  } catch (err) {
    if (history) await ws.fs.remove(history).catch(() => {});
    await ws.secure().catch(() => {});
    throw err;
  }
  await ws.secure(); // judgements are private, as the marking is
  return judgement;
}

async function archive(ws: Workspace, submissionId: string, when: Date): Promise<string> {
  const stamp = when.toISOString().replace(/[-:]/g, "").replace(/\.(\d{3})Z$/, "$1000");
  const base = `${JUDGEMENTS}/history/${submissionId}--${stamp}`;
  let history = `${base}.json`;
  for (let n = 2; await ws.exists(history); n++) history = `${base}-${n}.json`;
  await ws.writeJson(history, await ws.readJson(judgementPath(submissionId)));
  return history;
}
