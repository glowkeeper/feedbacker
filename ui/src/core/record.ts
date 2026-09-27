/**
 * The moderation record (#20): everything for one moderation, assembled from
 * the workspace, approved by the moderator, and exported as the structured
 * audit record.
 *
 * - **Assembled** from the request, the source rubric, each sampled
 *   submission (without its extract: the record is pseudonymous), every
 *   marker's record, the AI suggestions with their call records, the
 *   moderator's judgements (with their mode, reveal and revision) and
 *   verdicts. Arrays are in a fixed order, so the same workspace always gives
 *   the same record.
 * - **Ready** only when the moderation is complete and current: every sampled
 *   submission approved, reviewed (a blind review revealed), judged on every
 *   criterion against the text and rubric as they are now, with its marking
 *   confirmed and a current verdict, and no record that doesn't load. Anything
 *   short of that is listed, and nothing is approved.
 * - **Approved** explicitly by the moderator, with an optional overall comment
 *   (anonymised), and kept in `record/record.json` (private); an earlier
 *   approval is kept in `record/history/`.
 * - **Exported** into `exports/` only while the workspace still matches what
 *   was approved; if anything has changed since, it must be approved again.
 */

import { apply, detect, incompleteIn, loadRules, stillToRedact } from "./anonymise.ts";
import { approvedText } from "./boundary.ts";
import { serialiseRecord } from "./contract.ts";
import { markingDigest, readingProblems, rubricDigest, staleJudgements, staleVerdict } from "./evidence.ts";
import { loadJudgements } from "./judgement.ts";
import { loadRubric, MARKING, markingPath } from "./marking.ts";
import { type AISuggestion, ModerationRecord, type ModeratorJudgement, OriginalAssessment, type RecordSubmission, type SubmissionVerdict } from "./models.ts";
import { loadSubmission } from "./originals.ts";
import { loadReadings, readingPath } from "./reading.ts";
import { loadRequest, MODERATOR } from "./request.ts";
import { currentReview } from "./reviewState.ts";
import { loadVerdict } from "./verdict.ts";
import { type Workspace, WorkspaceError } from "./workspace.ts";

export const RECORD_DIR = "record";
export const RECORD = `${RECORD_DIR}/record.json`;

/** The moderation isn't ready to approve, or has changed since it was approved. `problems` lists every reason. */
export class RecordNotReady extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`the moderation record isn't ready:\n- ${problems.join("\n- ")}`);
    this.name = "RecordNotReady";
    this.problems = problems;
  }
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The record's ID: the workspace's name, as an identifier. */
export const recordId = (ws: Workspace) =>
  ws.manifest.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 64) || "moderation";

/** A submission's marking records that load and are filed where they belong; the rest are problems. */
async function sampledMarking(ws: Workspace, submissionId: string, problems: string[]): Promise<OriginalAssessment[]> {
  if (!(await ws.exists(MARKING))) return [];
  const out: OriginalAssessment[] = [];
  for (const e of (await ws.fs.list(MARKING)).filter((x) => x.kind === "file").sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!e.name.startsWith(`${submissionId}--`) || !e.name.endsWith(".json")) continue;
    const path = `${MARKING}/${e.name}`;
    const parsed = OriginalAssessment.safeParse(await ws.readJson(path).catch(() => null));
    if (!parsed.success) problems.push(`${path} is not a valid marking record`);
    else if (parsed.data.submission_id !== submissionId || markingPath(submissionId, parsed.data.marker_label) !== path) {
      problems.push(`${path} doesn't match the submission and marker it records`);
    } else out.push(parsed.data);
  }
  return out;
}

export interface Assembly {
  record: ModerationRecord | null; // null while there are problems
  problems: string[];
}

/** Assemble the record from the workspace as it is now, unapproved; or list why it isn't ready. */
export async function assembleRecord(ws: Workspace, now?: Date): Promise<Assembly> {
  const problems: string[] = [];
  const request = await loadRequest(ws); // no record without a request
  let rubric;
  try {
    rubric = await loadRubric(ws);
  } catch (err) {
    return { record: null, problems: [message(err)] };
  }
  const submissions: RecordSubmission[] = [];
  const assessments: OriginalAssessment[] = [];
  const suggestions: AISuggestion[] = [];
  const judgements: ModeratorJudgement[] = [];
  const verdicts: SubmissionVerdict[] = [];
  const inputs = new Set<string>([rubricDigest(rubric)]);
  // Anonymisation is re-checked with the key and rules as they are now: they may have grown since any text was anonymised.
  const key = await ws.readKey();
  const rules = await loadRules(ws);
  const incomplete = (...texts: (string | null)[]) => texts.some((t) => stillToRedact(t, key, rules) > 0);
  const AGAIN = "something the anonymisation rules or pseudonym key now redact; press Anonymise now";

  for (const s of request.sample) {
    const id = s.submission_id;
    const own: string[] = [];
    let approved: string | null = null;
    let approvalId: string | null = null;
    try {
      const sub = await loadSubmission(ws, id);
      const [, approval] = await approvedText(ws, id);
      approved = approval.approved_text_sha256;
      approvalId = approval.id;
      inputs.add(approved);
      if (incomplete(sub.anonymised!.text)) own.push("its approved text contains something the anonymisation rules or pseudonym key now redact; anonymise it again and approve it");
      submissions.push({ ...sub, extract: null, listed_band: s.listed_band }); // pseudonymous: never the original text
    } catch (err) {
      own.push(message(err));
    }
    try {
      const review = await currentReview(ws, id);
      if (!review) own.push("not reviewed yet");
      else if (review.mode === "blind" && review.revealed_at === null) own.push("its blind review hasn't been revealed");
    } catch (err) {
      own.push(message(err));
    }
    try {
      const js = await loadJudgements(ws, id);
      const stale = new Set(staleJudgements(js, approved, rubric));
      const judged = new Set(js.map((j) => j.criterion_id));
      const missing = rubric.criteria.filter((c) => !judged.has(c.id)).map((c) => c.title);
      const again = rubric.criteria.filter((c) => stale.has(c.id)).map((c) => c.title);
      if (missing.length) own.push(`still to judge: ${missing.join(", ")}`);
      if (again.length) own.push(`to judge again (judged against an earlier approved text or rubric): ${again.join(", ")}`);
      if (js.some((j) => incomplete(j.first.comment, j.revised?.comment ?? null))) own.push(`your comments on its criteria contain ${AGAIN}`);
      const order = new Map(rubric.criteria.map((c, i) => [c.id, i]));
      judgements.push(...js.sort((a, b) => order.get(a.criterion_id)! - order.get(b.criterion_id)!));
    } catch (err) {
      own.push(message(err));
    }
    const markingProblems: string[] = [];
    const markings = await sampledMarking(ws, id, markingProblems);
    own.push(...markingProblems);
    if (!markings.length && !markingProblems.length) own.push("no original marking has been imported or entered");
    for (const m of markings) {
      if (m.confirmed_at === null) own.push(`the ${m.marker_label} marking isn't confirmed`);
      if (incomplete(m.overall_comment, ...m.criterion_marks.map((x) => x.comment), ...m.annotations.map((x) => x.text))) own.push(`the ${m.marker_label}'s comments contain ${AGAIN}`);
      inputs.add(markingDigest(m));
    }
    assessments.push(...markings.sort((a, b) => (a.marker_label < b.marker_label ? -1 : 1)));
    try {
      const verdict = await loadVerdict(ws, id);
      if (!verdict) own.push("no verdict on the marking yet");
      else if (staleVerdict(verdict, approved, markings)) own.push("its verdict was given on earlier marking or an earlier approved text; check it again");
      else {
        if (incomplete(verdict.comment)) own.push(`your comment on its marking contains ${AGAIN}`);
        verdicts.push(verdict);
      }
    } catch (err) {
      own.push(message(err));
    }
    if (await ws.exists(readingPath(id))) {
      try {
        const readings = await loadReadings(ws, id);
        const wrong = readingProblems(id, readings, approved, { approvalId, rubric });
        own.push(...wrong);
        if (!wrong.length) {
          const order = new Map(rubric.criteria.map((c, i) => [c.id, i]));
          suggestions.push(...readings.sort((a, b) => (order.get(a.criterion_id) ?? 0) - (order.get(b.criterion_id) ?? 0)));
        }
      } catch (err) {
        own.push(message(err));
      }
    }
    problems.push(...own.map((p) => `${id} ${s.pseudonym}: ${p}`));
  }
  if (problems.length) return { record: null, problems };

  const assembled = ModerationRecord.safeParse({
    id: recordId(ws),
    context: request.context,
    rubric,
    submissions,
    original_assessments: assessments,
    ai_suggestions: suggestions,
    judgements,
    verdicts,
    provenance: {
      source: `workspace:${ws.manifest.name}`,
      transformation: "recorded",
      actor: MODERATOR,
      timestamp: (now ?? new Date()).toISOString(),
      input_hashes: [...inputs].sort(),
    },
  });
  // Anything the checks above didn't foresee is still a reason, never a raw error.
  if (!assembled.success) return { record: null, problems: assembled.error.issues.map((i) => `the record doesn't validate: ${i.message}`) };
  return { record: assembled.data, problems: [] };
}

/** What a record says about the moderation, apart from its approval: two records with the same content record the same moderation. */
const content = (r: ModerationRecord) =>
  JSON.stringify({ ...r, overall_comment: null, approved_by: null, approved_at: null, provenance: { ...r.provenance, timestamp: null } });

/** Whether two records record the same moderation (their approvals and timestamps aside). */
export const sameModeration = (a: ModerationRecord, b: ModerationRecord) => content(a) === content(b);

export async function loadApprovedRecord(ws: Workspace): Promise<ModerationRecord | null> {
  if (!(await ws.exists(RECORD))) return null;
  const parsed = ModerationRecord.safeParse(await ws.readJson(RECORD));
  if (!parsed.success || parsed.data.approved_at === null) throw new WorkspaceError(`${RECORD} is not a valid approved moderation record; approve the record again`);
  return parsed.data;
}

/** The moderator approves the record as it is now, with an optional overall comment. */
export async function approveRecord(ws: Workspace, options: { overallComment?: string | null; now?: Date } = {}): Promise<ModerationRecord> {
  const now = options.now ?? new Date();
  const { record, problems } = await assembleRecord(ws, now);
  if (!record) throw new RecordNotReady(problems);
  const key = await ws.readKey();
  const rules = await loadRules(ws);
  const text = options.overallComment?.trim() || null;
  const approved = ModerationRecord.parse({
    ...record,
    overall_comment: text && apply(text, detect(text, key, rules), key)[0],
    approved_by: MODERATOR,
    approved_at: now.toISOString(),
  });
  let history: string | null = null;
  try {
    await ws.writeKey(key); // anonymising the comment may have added a token
    if (await ws.exists(RECORD)) {
      const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.(\d{3})Z$/, "$1000");
      history = `${RECORD_DIR}/history/record--${stamp}.json`;
      for (let n = 2; await ws.exists(history); n++) history = `${RECORD_DIR}/history/record--${stamp}-${n}.json`;
      await ws.writeJson(history, await ws.readJson(RECORD));
    }
    await ws.writeJson(RECORD, approved);
  } catch (err) {
    if (history) await ws.fs.remove(history).catch(() => {});
    await ws.secure().catch(() => {});
    throw err;
  }
  await ws.secure();
  return approved;
}

/**
 * The approved record, if the workspace still matches it; refused if nothing
 * is approved, or if anything has changed since the approval.
 */
export async function currentApprovedRecord(ws: Workspace, now?: Date): Promise<ModerationRecord> {
  const approved = await loadApprovedRecord(ws);
  if (!approved) throw new WorkspaceError("the moderation record hasn't been approved; approve it before exporting");
  const { record, problems } = await assembleRecord(ws, now);
  if (!record) throw new RecordNotReady(["the moderation has changed since it was approved, and isn't ready to approve again:", ...problems]);
  if (!sameModeration(record, approved)) throw new RecordNotReady(["the moderation has changed since it was approved; approve it again before exporting"]);
  if (await incompleteIn(ws, approved.overall_comment)) {
    throw new RecordNotReady(["your overall comment contains something the anonymisation rules or pseudonym key now redact; approve the record again"]);
  }
  return approved;
}

/** Export the approved record, as JSON, into `exports/`, while the workspace still matches it. */
export async function exportRecord(ws: Workspace, now?: Date): Promise<{ path: string; record: ModerationRecord }> {
  const approved = await currentApprovedRecord(ws, now);
  const path = await ws.writeExport(`${approved.id}-record`, "json", serialiseRecord(ModerationRecord, approved, "moderation record"));
  await ws.secure();
  return { path, record: approved };
}
