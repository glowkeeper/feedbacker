/**
 * The moderation record: everything for one moderation, assembled from
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

import { incompleteIn, loadRules, redactor } from "./anonymise.ts";
import { redactionsFound, type RedactionMatch, type RedactionSource } from "./redactions.ts";
import { approvedText } from "./boundary.ts";
import { serialiseRecord } from "./contract.ts";
import { markingDigest, readingProblems, rubricDigest, staleJudgements, staleVerdict } from "./evidence.ts";
import { loadJudgements } from "./judgement.ts";
import { loadRubric, MARKING, markingPath } from "./marking.ts";
import { type AISuggestion, type ApprovedFigure, ModerationRecord, type ModeratorJudgement, OriginalAssessment, type RecordSubmission, type SubmissionVerdict } from "./models.ts";
import { loadSubmission } from "./originals.ts";
import { loadReadings, readingPath } from "./reading.ts";
import { loadRequest, MODERATOR } from "./request.ts";
import { currentReview } from "./reviewState.ts";
import { loadVerdict } from "./verdict.ts";
import { sha256Text } from "./text.ts";
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

/** Where a reason the record isn't ready is put right, so a caller can point to it; null when there is no one place. */
export type RecordArea = "rubric" | "anonymisation" | "marking" | "review" | "reading";

export interface RecordProblem {
  text: string;
  area: RecordArea | null;
  /** For a reason that is text the rules now redact: exactly what and where, and whose it is, for the educator's own screen only. */
  matches?: RedactionMatch[];
  subject?: string;
}

export interface Assembly {
  record: ModerationRecord | null; // null while there are problems
  problems: string[];
  reasons: RecordProblem[]; // the same problems, each with where it is put right
}

const assembly = (record: ModerationRecord | null, reasons: RecordProblem[]): Assembly => ({ record, problems: reasons.map((r) => r.text), reasons });

/** Assemble the record from the workspace as it is now, unapproved; or list why it isn't ready. */
export async function assembleRecord(ws: Workspace, now?: Date): Promise<Assembly> {
  const reasons: RecordProblem[] = [];
  const request = await loadRequest(ws); // no record without a request
  let rubric;
  try {
    rubric = await loadRubric(ws);
  } catch (err) {
    return assembly(null, [{ text: message(err), area: "rubric" }]);
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
  const AGAIN = "something the anonymisation rules or pseudonym key now redact; press Anonymise now";
  const titleOf = (id: string) => rubric.criteria.find((c) => c.id === id)?.title ?? id;

  for (const s of request.sample) {
    const id = s.submission_id;
    const own: RecordProblem[] = [];
    const add = (area: RecordArea, ...texts: string[]) => own.push(...texts.map((text) => ({ text, area })));
    // A reason that is text the rules now redact, with exactly what and where (nothing if every text is complete).
    const redacted = (text: string, sources: RedactionSource[]) => {
      const matches = redactionsFound(sources, key, rules);
      if (matches.length) own.push({ text, area: "anonymisation", matches });
    };
    let approved: string | null = null;
    let approvalId: string | null = null;
    let approvedFigures: ApprovedFigure[] | null = null;
    try {
      const sub = await loadSubmission(ws, id);
      const [, approval] = await approvedText(ws, id);
      approved = approval.approved_text_sha256;
      approvalId = approval.id;
      approvedFigures = approval.figures;
      inputs.add(approved);
      redacted("its approved text contains something the anonymisation rules or pseudonym key now redact; anonymise it again and approve it", [["approved text", "text", sub.anonymised!.text]]);
      submissions.push({ ...sub, extract: null, listed_band: s.listed_band }); // pseudonymous: never the original text
    } catch (err) {
      add("anonymisation", message(err));
    }
    try {
      const review = await currentReview(ws, id);
      if (!review) add("review", "not reviewed yet");
      else if (review.mode === "blind" && review.revealed_at === null) add("review", "its blind review hasn't been revealed");
    } catch (err) {
      add("review", message(err));
    }
    let js: ModeratorJudgement[] = [];
    try {
      js = await loadJudgements(ws, id);
      const stale = new Set(staleJudgements(js, approved, rubric));
      const judged = new Set(js.map((j) => j.criterion_id));
      const missing = rubric.criteria.filter((c) => !judged.has(c.id)).map((c) => c.title);
      const again = rubric.criteria.filter((c) => stale.has(c.id)).map((c) => c.title);
      if (missing.length) add("review", `still to judge: ${missing.join(", ")}`);
      if (again.length) add("review", `to judge again (judged against an earlier approved text or rubric; on Review, check each and press "Record it again"): ${again.join(", ")}`);
      redacted(
        `your comments on its criteria contain ${AGAIN}`,
        js.flatMap((j): RedactionSource[] => [
          [`your comment on ${titleOf(j.criterion_id)}`, "comment", j.first.comment],
          [`your revised comment on ${titleOf(j.criterion_id)}`, "comment", j.revised?.comment],
        ]),
      );
      const order = new Map(rubric.criteria.map((c, i) => [c.id, i]));
      judgements.push(...js.sort((a, b) => order.get(a.criterion_id)! - order.get(b.criterion_id)!));
    } catch (err) {
      add("review", message(err));
    }
    const markingProblems: string[] = [];
    const markings = await sampledMarking(ws, id, markingProblems);
    add("marking", ...markingProblems);
    if (!markings.length && !markingProblems.length) add("marking", "no original marking has been imported or entered");
    for (const m of markings) {
      if (m.confirmed_at === null) add("marking", `the ${m.marker_label} marking isn't confirmed`);
      redacted(`the ${m.marker_label}'s comments contain ${AGAIN}`, [
        [`the ${m.marker_label}'s overall comment`, "comment", m.overall_comment],
        ...m.criterion_marks.map((x): RedactionSource => [`the ${m.marker_label}'s comment on ${titleOf(x.criterion_id)}`, "comment", x.comment]),
        ...m.annotations.flatMap((x): RedactionSource[] => {
          const note = x.number ? `annotation ${x.number}` : "an annotation";
          return [
            [`the ${m.marker_label}'s ${note}`, "comment", x.text],
            [`the text the ${m.marker_label}'s ${note} is on`, "comment", x.anchor_text],
          ];
        }),
      ]);
      inputs.add(markingDigest(m));
    }
    assessments.push(...markings.sort((a, b) => (a.marker_label < b.marker_label ? -1 : 1)));
    try {
      const verdict = await loadVerdict(ws, id);
      if (!verdict) add("review", "no verdict on the marking yet");
      else if (staleVerdict(verdict, approved, markings, rubric, js)) add("review", "its verdict was given on earlier marking, an earlier approved text or rubric, or other marks of yours; check it again");
      else {
        redacted(`your comment on its marking contains ${AGAIN}`, [["your comment on its marking", "comment", verdict.comment]]);
        verdicts.push(verdict);
      }
    } catch (err) {
      add("review", message(err));
    }
    if (await ws.exists(readingPath(id))) {
      try {
        const readings = await loadReadings(ws, id);
        const wrong = readingProblems(id, readings, approved, { approvalId, rubric, approvedFigures });
        add("reading", ...wrong);
        // A model's words are exported as it wrote them, so they are checked too; they aren't changed afterwards (the call record hashes them).
        if (!wrong.length) {
          const matches = redactionsFound(
            readings.flatMap((r): RedactionSource[] => [
              [`the AI reading's reasoning on ${titleOf(r.criterion_id)}`, "reading", r.rationale],
              [`the AI reading's draft comment on ${titleOf(r.criterion_id)}`, "reading", r.draft_comment],
              ...r.evidence.map((e): RedactionSource => [`the AI reading's evidence on ${titleOf(r.criterion_id)}`, "reading", e.text]),
            ]),
            key,
            rules,
          );
          if (matches.length) own.push({ text: `its AI reading contains something the anonymisation rules or pseudonym key now redact; run the reading again${matches.some((m) => m.keepable) ? ", or keep what was found" : ""}`, area: "reading", matches });
        }
        if (!wrong.length) {
          const order = new Map(rubric.criteria.map((c, i) => [c.id, i]));
          suggestions.push(...readings.sort((a, b) => (order.get(a.criterion_id) ?? 0) - (order.get(b.criterion_id) ?? 0)));
        }
      } catch (err) {
        add("reading", message(err));
      }
    }
    reasons.push(...own.map((p) => ({ ...p, text: `${id} ${s.pseudonym}: ${p.text}`, subject: `${id} ${s.pseudonym}` })));
  }
  if (reasons.length) return assembly(null, reasons);

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
  if (!assembled.success) return assembly(null, assembled.error.issues.map((i) => ({ text: `the record doesn't validate: ${i.message}`, area: null })));
  return assembly(assembled.data, []);
}

/** What a record says about the moderation, apart from its approval: two records with the same content record the same moderation. */
const content = (r: ModerationRecord) =>
  JSON.stringify({ ...r, overall_comment: null, overall_comment_derived_from_ai: false, approved_by: null, approved_at: null, provenance: { ...r.provenance, timestamp: null } });

/** Whether two records record the same moderation (their approvals and timestamps aside). */
export const sameModeration = (a: ModerationRecord, b: ModerationRecord) => content(a) === content(b);

/** A digest of what a record says about the moderation (its approval, comment and timestamps aside): what the moderator is shown, and what an approval is of. */
export const moderationDigest = (r: ModerationRecord) => sha256Text(content(r));

export async function loadApprovedRecord(ws: Workspace): Promise<ModerationRecord | null> {
  if (!(await ws.exists(RECORD))) return null;
  const parsed = ModerationRecord.safeParse(await ws.readJson(RECORD));
  if (!parsed.success || parsed.data.approved_at === null) throw new WorkspaceError(`${RECORD} is not a valid approved moderation record; approve the record again`);
  return parsed.data;
}

/**
 * The moderator approves the record as it is now, with an optional overall comment. With `shown` (the digest of the summary the moderator was
 * shown), nothing is approved if the moderation is no longer that: it changed after it was shown, and approving what was never seen would not be
 * the moderator's approval.
 */
export async function approveRecord(
  ws: Workspace,
  options: { overallComment?: string | null; overallCommentFromAi?: boolean; shown?: string; now?: Date } = {},
): Promise<ModerationRecord> {
  const now = options.now ?? new Date();
  const { record, problems } = await assembleRecord(ws, now);
  if (!record) throw new RecordNotReady(problems);
  if (options.shown !== undefined && options.shown !== moderationDigest(record)) {
    throw new WorkspaceError("the moderation has changed since the summary was shown here, so nothing was approved; it is shown again: read it, then approve it");
  }
  const redact = await redactor(ws);
  const text = options.overallComment?.trim() || null;
  const approved = ModerationRecord.parse({
    ...record,
    overall_comment: redact.text(text),
    overall_comment_derived_from_ai: options.overallCommentFromAi === true && text !== null,
    approved_by: MODERATOR,
    approved_at: now.toISOString(),
  });
  let history: string | null = null;
  try {
    await redact.keep();
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
