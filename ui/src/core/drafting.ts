/**
 * Drafting feedback (ADR 0006): the AI drafts feedback for each criterion, and an overall summary, from the educator's
 * own marks and comments for one submission; the educator adapts each draft, or writes their own, and records it.
 *
 * What is sent: the instructions (`feedback-v3`), the rubric, the approved brief, the approved anonymised submission,
 * and the educator's marking of that one submission (each criterion's level, mark and anonymised comment, and the
 * overall mark and comment). Never another student's material, and never the AI's own earlier proposals. The marking
 * is shown to the educator exactly as it will be sent, and confirming the plan approves it: each request is rebuilt
 * from the workspace just before it is sent, and must equal the one confirmed, or nothing is sent for that submission.
 * The proxy accepts the marking only in a drafting request (proxy/src/boundary.ts).
 *
 * Every draft records the digest of the marking it was drafted from, so a draft whose criterion's level, mark or
 * comment has changed since is flagged, and that criterion alone can be drafted again. The educator's feedback records
 * the same digest. Every call leaves its record and raw response (`feedback/calls`, `feedback/raw`), and every run its
 * log (`feedback/runs`); replaced drafts and feedback are kept in `feedback/history`.
 */

import * as z from "zod";
import { apply, detect, loadRules } from "./anonymise.ts";
import { EDUCATOR } from "./assessment.ts";
import { approvedText, requireComplete, UnapprovedText } from "./boundary.ts";
import { BatchProgress } from "./batch.ts";
import { listSubmissions } from "./cohort.ts";
import { staleJudgements } from "./evidence.ts";
import { inSample, loadJudgements } from "./judgement.ts";
import { loadRubric } from "./marking.ts";
import { criterionMax, entryMark } from "./marks.ts";
import { Feedback, FeedbackDraft, ModelCall, TokenUsage, type Approval, type JudgementEntry, type Rubric, type SubmissionMark } from "./models.ts";
import { PROMPTS } from "./prompts.ts";
import { pyFormatG, pyRound } from "./pytext.ts";
import {
  callRecord,
  type CallInputs,
  currentMaterial,
  DEFAULT_CAP_USD,
  DEFAULT_MODEL,
  estimate,
  FALLBACK_MODEL,
  freePath,
  isoformat,
  type Material,
  priceOf,
  type ProxyResponse,
  ReadingError,
  type ReadingProxy,
  type ReadingRequest,
  renderRubric,
  requestKey,
  stampOf,
} from "./reading.ts";
import { loadSubmissionMark, submissionMarkStale } from "./submissionMark.ts";
import { sha256Text } from "./text.ts";
import { BRIEF } from "./brief.ts";
import { approvedGuide, GUIDE } from "./guide.ts";
import { checkCriterionFeedback, checkFeedback, endsMidSentence, loadPraise, strayEnding, unaccepted, withoutStrayEnding, type Flag } from "./feedbackChecks.ts";
import { ProviderError, ProxyRefusal, type Workspace, WorkspaceError } from "./workspace.ts";

export const FEEDBACK = "feedback";
export const FEEDBACK_PROMPT_VERSION = "feedback-v3";
/** A drafting target: a criterion's id, or this, for the overall summary. */
export const OVERALL = "overall";
export const FEEDBACK_BATCHES = `${FEEDBACK}/batches`;
const MAX_DRAFT_TOKENS = 8000;

export const draftsPath = (submissionId: string) => `${FEEDBACK}/drafts/${submissionId}.json`;
export const feedbackPath = (submissionId: string) => `${FEEDBACK}/${submissionId}.json`;
/** The AI's suggested edits to the educator's recorded feedback (suggestEdit.ts), every one kept. */
export const suggestionsPath = (submissionId: string) => `${FEEDBACK}/suggestions/${submissionId}.json`;
export const targetOf = (criterionId: string | null) => criterionId ?? OVERALL;

export class DraftingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftingError";
  }
}

// --- What the AI returns -----------------------------------------------------------------------------

/** The AI's drafts: feedback by criterion id, and the overall summary (null when it isn't asked for). */
export const FeedbackOut = z.strictObject({
  criteria: z.record(z.string(), z.string()),
  overall: z.string().nullable(),
});
export type FeedbackOut = z.output<typeof FeedbackOut>;

/**
 * The JSON Schema the AI must follow for these targets: a required field for each criterion asked for, and the
 * overall summary a required string when it is asked for (null otherwise). The provider holds the AI to it, so a
 * draft can't be left out (a list of drafts could come back short).
 */
export function feedbackSchema(targets: string[]): Record<string, unknown> {
  const criteria = targets.filter((t) => t !== OVERALL);
  return {
    type: "object",
    properties: {
      criteria: { type: "object", properties: Object.fromEntries(criteria.map((c) => [c, { type: "string" }])), required: criteria, additionalProperties: false },
      overall: targets.includes(OVERALL) ? { type: "string" } : { type: "null" },
    },
    required: ["criteria", "overall"],
    additionalProperties: false,
  };
}

// --- The educator's marking, as it stands ------------------------------------------------------------

/** One submission's marking: what can be drafted from, and the digest each target would be drafted from. */
export interface EducatorMarking {
  submissionId: string;
  pseudonym: string;
  rubric: Rubric;
  text: string; // the approved anonymised text
  approval: Approval;
  entries: Map<string, JudgementEntry>; // each criterion's current level, mark and comment (not those out of date)
  overall: SubmissionMark | null; // the overall mark and comment, while current
  basis: Map<string, string>; // by target: the digest of the marking it would be drafted from; only targets that can be drafted
  missing: Map<string, string>; // by target: why it can't be drafted yet
}

const criterionBasis = (rubric: Rubric, criterionId: string, e: JudgementEntry) =>
  sha256Text(JSON.stringify(["criterion", criterionId, e.level_id, entryMark(rubric.criteria.find((c) => c.id === criterionId)!, e), e.comment ?? null]));

/** The educator's current marking of one submission, read from the workspace. */
export async function educatorMarking(ws: Workspace, submissionId: string): Promise<EducatorMarking> {
  if (ws.manifest.workspace_type !== "marking") throw new DraftingError("only a marking workspace drafts feedback");
  await inSample(ws, submissionId);
  const pseudonym = (await listSubmissions(ws)).find((s) => s.submission_id === submissionId)!.pseudonym;
  const rubric = await loadRubric(ws);
  const [text, approval] = await approvedText(ws, submissionId);
  const judgements = await loadJudgements(ws, submissionId);
  const stale = new Set(staleJudgements(judgements, approval.approved_text_sha256, rubric));
  const m: EducatorMarking = { submissionId, pseudonym, rubric, text, approval, entries: new Map(), overall: null, basis: new Map(), missing: new Map() };
  for (const c of rubric.criteria) {
    const j = judgements.find((x) => x.criterion_id === c.id);
    if (!j) m.missing.set(c.id, `${c.title} isn't marked yet`);
    else if (stale.has(c.id)) m.missing.set(c.id, `the mark of ${c.title} is out of date; record it again`);
    else {
      const e = j.revised ?? j.first;
      m.entries.set(c.id, e);
      m.basis.set(c.id, criterionBasis(rubric, c.id, e));
    }
  }
  const mark = await loadSubmissionMark(ws, submissionId);
  if (m.entries.size < rubric.criteria.length) m.missing.set(OVERALL, "every criterion must be marked first");
  else if (!mark) m.missing.set(OVERALL, "record the overall mark first");
  else if (await submissionMarkStale(ws, mark)) m.missing.set(OVERALL, "the overall mark is out of date; record it again");
  else {
    m.overall = mark;
    const all = rubric.criteria.map((c) => {
      const e = m.entries.get(c.id)!;
      return [c.id, e.level_id, entryMark(c, e), e.comment ?? null];
    });
    m.basis.set(OVERALL, sha256Text(JSON.stringify(["overall", all, mark.mark, mark.comment ?? null])));
  }
  return m;
}

/** The educator's marking as it is sent: which targets to draft, then every current criterion's mark and comment, and the overall. */
/** Words or phrases to avoid in a target's feedback (from Feedbacker's own check, never the student's text): they overstate the mark. */
export type Avoid = Record<string, string[]>;

const avoidLine = (words: string[] | undefined) => (words?.length ? [`Words to avoid in this feedback, because they overstate the mark: ${words.join(", ")}`] : []);

export function renderMarking(m: EducatorMarking, targets: string[], avoid: Avoid = {}): string {
  const criteria = targets.filter((t) => t !== OVERALL);
  const lines = [
    `Draft feedback for these criteria (by id): ${criteria.length ? criteria.join(", ") : "none"}`,
    `Draft the overall summary: ${targets.includes(OVERALL) ? "yes" : "no"}`,
  ];
  for (const c of m.rubric.criteria) {
    const e = m.entries.get(c.id);
    if (!e) continue;
    const level = c.levels.find((l) => l.id === e.level_id);
    const mark = entryMark(c, e);
    const max = criterionMax(c);
    lines.push(
      "",
      `Criterion id: ${c.id}`,
      `Level: ${level?.label ?? e.level_id} (level id ${e.level_id})`,
      `Mark: ${mark === null ? "none" : pyFormatG(mark)}${max !== null ? ` out of ${pyFormatG(max)}` : ""}`,
      `The educator's comment: ${e.comment?.trim() ? e.comment.trim() : "(none)"}`,
      ...(targets.includes(c.id) ? avoidLine(avoid[c.id]) : []),
    );
  }
  if (m.overall) {
    lines.push("", `Overall mark: ${pyFormatG(m.overall.mark)}`, `The educator's overall comment: ${m.overall.comment?.trim() ? m.overall.comment.trim() : "(none)"}`, ...(targets.includes(OVERALL) ? avoidLine(avoid[OVERALL]) : []));
  }
  return lines.join("\n");
}

/** What every drafting request in a run is sent: the rubric, the approved brief and the approved feedback guide, if they are included. */
export type DraftMaterial = Material & { guide: { text: string; sha256: string; version: number } | null };

async function draftMaterial(ws: Workspace, withBrief: boolean, withGuide: boolean): Promise<DraftMaterial> {
  const material = await asDraftingAsync(() => currentMaterial(ws, withBrief));
  let guide: DraftMaterial["guide"] = null;
  if (withGuide) {
    try {
      guide = await approvedGuide(ws);
    } catch (err) {
      if (err instanceof UnapprovedText) throw new DraftingError(err.message);
      throw err;
    }
  }
  return { ...material, guide };
}

/** Stable content first (instructions, rubric, brief, guide), then the submission and the marking, as the proxy requires. */
export function buildDraftRequest(material: DraftMaterial, m: EducatorMarking, targets: string[], model: string, promptVersion = FEEDBACK_PROMPT_VERSION, avoid: Avoid = {}): ReadingRequest {
  const marking = renderMarking(m, targets, avoid);
  return {
    model,
    max_output_tokens: MAX_DRAFT_TOKENS,
    prompt: { version: promptVersion, instructions: PROMPTS[promptVersion] },
    blocks: [
      { kind: "rubric", heading: "RUBRIC", text: renderRubric(material.rubric), approved_sha256: null },
      ...(material.brief ? [{ kind: "brief" as const, heading: "ASSESSMENT BRIEF", text: material.brief.text, approved_sha256: material.brief.sha256 }] : []),
      // The same for every submission, so drafts across the cohort start from the same place (and it is cached with the rest).
      ...(material.guide ? [{ kind: "guide" as const, heading: "THE EDUCATOR'S FEEDBACK GUIDE", text: material.guide.text, approved_sha256: material.guide.sha256 }] : []),
      { kind: "submission", heading: `SUBMISSION ${m.pseudonym}`, text: m.text, approved_sha256: m.approval.approved_text_sha256 },
      // Approved as exactly this text: the educator is shown it before confirming.
      { kind: "marking", heading: "THE EDUCATOR'S MARKING", text: marking, approved_sha256: sha256Text(marking) },
    ],
    output_schema: feedbackSchema(targets),
  };
}

// --- Drafts and feedback on disk ----------------------------------------------------------------------

export async function loadDrafts(ws: Workspace, submissionId: string): Promise<FeedbackDraft[]> {
  const path = draftsPath(submissionId);
  if (!(await ws.exists(path))) return [];
  const parsed = z.array(FeedbackDraft).safeParse(await ws.readJson(path));
  if (!parsed.success || parsed.data.some((d) => d.submission_id !== submissionId)) throw new WorkspaceError(`${path} is not a valid set of feedback drafts`);
  return parsed.data;
}

export async function loadSuggestions(ws: Workspace, submissionId: string): Promise<FeedbackDraft[]> {
  const path = suggestionsPath(submissionId);
  if (!(await ws.exists(path))) return [];
  const parsed = z.array(FeedbackDraft).safeParse(await ws.readJson(path));
  if (!parsed.success || parsed.data.some((d) => d.submission_id !== submissionId || d.edited_from === null)) throw new WorkspaceError(`${path} is not a valid set of suggested edits`);
  return parsed.data;
}

export async function loadFeedback(ws: Workspace, submissionId: string): Promise<Feedback[]> {
  const path = feedbackPath(submissionId);
  if (!(await ws.exists(path))) return [];
  const parsed = z.array(Feedback).safeParse(await ws.readJson(path));
  if (!parsed.success || parsed.data.some((f) => f.submission_id !== submissionId)) throw new WorkspaceError(`${path} is not a valid set of feedback`);
  return parsed.data;
}

/** Replace a file's records for some targets, keeping the others, and the previous file in the history. */
async function replaceTargets<T extends { criterion_id: string | null }>(ws: Workspace, path: string, kind: string, submissionId: string, existing: T[], updated: T[], when: Date) {
  const replaced = new Set(updated.map((r) => targetOf(r.criterion_id)));
  const merged = [...existing.filter((r) => !replaced.has(targetOf(r.criterion_id))), ...updated];
  if (await ws.exists(path)) await ws.writeJson(await freePath(ws, `${FEEDBACK}/history/${submissionId}--${kind}--${stampOf(when)}`), await ws.readJson(path), { private: true });
  await ws.writeJson(path, merged, { private: true });
}

/** Whether a draft or feedback was made on other marking than there is now (or marking that can't be drafted from now). */
export const isStale = (m: EducatorMarking, criterionId: string | null, digest: string) => m.basis.get(targetOf(criterionId)) !== digest;

// --- The educator's feedback -------------------------------------------------------------------------

/**
 * Record the educator's feedback on one criterion (or `OVERALL`). `fromDraft` names the AI draft, or suggested edit, it
 * was adapted from: it must be a current draft or suggestion for that target, or the one the feedback already recorded
 * came from (so adapted feedback keeps its provenance when recorded again). The text is anonymised with the workspace's
 * rules.
 */
export async function recordFeedback(ws: Workspace, submissionId: string, target: string, input: { text: string; fromDraft?: string | null; now?: Date }): Promise<Feedback> {
  const m = await educatorMarking(ws, submissionId);
  const criterionId = target === OVERALL ? null : target;
  if (criterionId !== null && !m.rubric.criteria.some((c) => c.id === criterionId)) throw new WorkspaceError(`'${criterionId}' is not a criterion of the source rubric`);
  const basis = m.basis.get(target);
  if (!basis) throw new WorkspaceError(`feedback can't be recorded yet: ${m.missing.get(target)}`);
  const raw = input.text.trim();
  if (!raw) throw new WorkspaceError("write the feedback first");
  const existing = await loadFeedback(ws, submissionId);
  const previous = existing.find((f) => targetOf(f.criterion_id) === target);
  let fromDraft: string | null = input.fromDraft ?? null;
  if (fromDraft !== null && fromDraft !== previous?.from_draft) {
    const draft = [...(await loadDrafts(ws, submissionId)), ...(await loadSuggestions(ws, submissionId))].find((d) => d.id === fromDraft && targetOf(d.criterion_id) === target);
    if (!draft) throw new WorkspaceError(`there is no draft '${fromDraft}' of this feedback to adapt`);
    if (draft.drafted_from !== basis) throw new WorkspaceError("that draft was drafted from other marking than there is now; draft it again first");
  }
  const key = await ws.readKey();
  const rules = await loadRules(ws);
  const text = apply(raw, detect(raw, key, rules), key)[0];
  const now = input.now ?? new Date();
  const feedback = Feedback.parse({
    submission_id: submissionId,
    criterion_id: criterionId,
    text,
    derived_from_ai: fromDraft !== null,
    from_draft: fromDraft,
    given_on: basis,
    provenance: { source: `submission:${submissionId}`, transformation: previous ? "revised" : "recorded", actor: EDUCATOR, timestamp: now.toISOString(), input_hashes: [m.approval.approved_text_sha256, basis] },
  });
  try {
    await ws.writeKey(key); // anonymising may have added a token
    await replaceTargets(ws, feedbackPath(submissionId), "feedback", submissionId, existing, [feedback], now);
  } finally {
    await ws.secure().catch(() => {});
  }
  return feedback;
}

// --- Checks on the educator's feedback --------------------------------------------------------------------

/** One recorded piece of feedback's flags (feedbackChecks.ts), against the marking as it is now, and which are unaccepted. */
export interface FeedbackFlags {
  target: string;
  flags: Flag[];
  open: Flag[]; // not accepted for this text
}

/** The flags on a submission's recorded feedback, checked against its current marks, as it will be exported. */
export async function feedbackFlags(ws: Workspace, submissionId: string): Promise<FeedbackFlags[]> {
  const m = await educatorMarking(ws, submissionId);
  const praise = await loadPraise(ws);
  const out: FeedbackFlags[] = [];
  for (const f of await loadFeedback(ws, submissionId)) {
    let flags: Flag[];
    if (f.criterion_id === null) flags = checkFeedback(f.text, m.overall?.mark ?? (await loadSubmissionMark(ws, submissionId))?.mark ?? null, 100, praise);
    else {
      const c = m.rubric.criteria.find((x) => x.id === f.criterion_id);
      const e = m.entries.get(f.criterion_id);
      if (!c) continue;
      flags = e ? checkCriterionFeedback(f.text, c, e.level_id, entryMark(c, e), praise) : checkFeedback(f.text, null, null, praise);
    }
    out.push({ target: targetOf(f.criterion_id), flags, open: unaccepted(flags, f) });
  }
  return out;
}

/** Accept a flag on recorded feedback with a reason, kept on the feedback; the text is unchanged, and new text clears it. */
export async function acceptFlag(ws: Workspace, submissionId: string, target: string, flag: Pick<Flag, "check" | "detail">, reason: string, now: Date = new Date()): Promise<Feedback> {
  const why = reason.trim();
  if (!why) throw new WorkspaceError("give a short reason for keeping the text as it is");
  const existing = await loadFeedback(ws, submissionId);
  const previous = existing.find((f) => targetOf(f.criterion_id) === target);
  if (!previous) throw new WorkspaceError("record the feedback first");
  const raised = (await feedbackFlags(ws, submissionId)).find((x) => x.target === target)?.flags ?? [];
  if (!raised.some((f) => f.check === flag.check && f.detail === flag.detail)) throw new WorkspaceError("that flag isn't raised on this feedback as it is now");
  const accepted = [...previous.accepted_flags.filter((a) => !(a.check === flag.check && a.detail === flag.detail)), { check: flag.check, detail: flag.detail, reason: why }];
  const updated = Feedback.parse({ ...previous, accepted_flags: accepted, provenance: { ...previous.provenance, transformation: "revised", timestamp: now.toISOString() } });
  try {
    await replaceTargets(ws, feedbackPath(submissionId), "feedback", submissionId, existing, [updated], now);
  } finally {
    await ws.secure().catch(() => {});
  }
  return updated;
}

// --- Planning ------------------------------------------------------------------------------------------

export interface PlannedDraft {
  submissionId: string;
  pseudonym: string;
  targets: string[];
  avoid: Avoid; // words to avoid, by target, when drafting again after a flag
  marking: string; // exactly what is sent of the educator's marking, shown before confirming
  request: ReadingRequest;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  fallbackCost: number;
}

export interface DraftPlan {
  provider: string | null;
  model: string;
  capUsd: number;
  fallbackModel: string | null;
  withBrief: boolean;
  withGuide: boolean;
  guideVersion: number | null; // the guide every request in the plan is sent with
  batch: boolean;
  drafts: PlannedDraft[];
  skipped: Map<string, string>; // submission (or "submission/target") -> why
}

export interface DraftOptions {
  model?: string;
  capUsd?: number;
  fallback?: boolean;
  /** Include the approved brief; by default, whenever a brief is imported. */
  withBrief?: boolean;
  /** Include the approved feedback guide; by default, whenever one is written (it must then be approved). */
  withGuide?: boolean;
  batch?: boolean;
}

export const draftsCost = (plan: DraftPlan) => plan.drafts.reduce((n, d) => n + d.cost + d.fallbackCost, 0);

/**
 * Everything that would be sent to draft feedback, with a worst-case estimate; sends nothing. `wanted` lists the
 * submissions (every one in the cohort when null) and, for each, the targets to draft: by default, every target that
 * can be drafted and has no current draft (none yet, or drafted from marking that has changed since).
 */
export async function planDrafts(ws: Workspace, proxy: ReadingProxy, wanted: { submissionId: string; targets?: string[] | null; avoid?: Avoid }[] | null = null, options: DraftOptions = {}): Promise<DraftPlan> {
  if (ws.manifest.workspace_type !== "marking") throw new DraftingError("only a marking workspace drafts feedback");
  const model = options.model ?? DEFAULT_MODEL;
  const capUsd = options.capUsd ?? DEFAULT_CAP_USD;
  const fallback = options.fallback ?? true;
  if (!(capUsd > 0)) throw new DraftingError("the spend limit must be greater than 0");
  const { prices, provider, batch: canBatch } = await proxy.health();
  const batch = options.batch ?? false;
  if (batch && !canBatch) throw new DraftingError("the proxy's provider can't send a batch; draft one submission at a time instead");
  const price = asDrafting(() => priceOf(prices, model));
  if (fallback) asDrafting(() => priceOf(prices, FALLBACK_MODEL));
  const withBrief = options.withBrief ?? (await ws.exists(BRIEF));
  const withGuide = options.withGuide ?? (await ws.exists(GUIDE));
  const material = await draftMaterial(ws, withBrief, withGuide);
  const share = batch ? (price.batch ?? 1) : 1;
  const plan: DraftPlan = { provider, model, capUsd, fallbackModel: fallback ? FALLBACK_MODEL : null, withBrief, withGuide, guideVersion: material.guide?.version ?? null, batch, drafts: [], skipped: new Map() };
  const list = wanted ?? (await listSubmissions(ws)).map((s) => ({ submissionId: s.submission_id, targets: null }));
  for (const { submissionId, targets, avoid: asked } of list as { submissionId: string; targets?: string[] | null; avoid?: Avoid }[]) {
    const avoid: Avoid = asked ?? {};
    let m: EducatorMarking;
    try {
      m = await educatorMarking(ws, submissionId);
      await requireComplete(ws, submissionId, m.text); // left out if a later rule would redact more of its text
    } catch (err) {
      if (!(err instanceof WorkspaceError || err instanceof UnapprovedText || err instanceof DraftingError)) throw err;
      plan.skipped.set(submissionId, err.message);
      continue;
    }
    const all = [...m.rubric.criteria.map((c) => c.id), OVERALL];
    let chosen: string[];
    if (targets?.length) {
      chosen = [];
      for (const t of targets) {
        if (!all.includes(t)) plan.skipped.set(`${submissionId}/${t}`, `'${t}' is not a criterion of the source rubric`);
        else if (!m.basis.has(t)) plan.skipped.set(`${submissionId}/${t}`, m.missing.get(t)!);
        else chosen.push(t);
      }
    } else {
      // Drafts that don't load are reported, never taken for none: that could send paid requests for drafts already made.
      let drafts: FeedbackDraft[];
      try {
        drafts = await loadDrafts(ws, submissionId);
      } catch (err) {
        if (!(err instanceof WorkspaceError)) throw err;
        plan.skipped.set(submissionId, err.message);
        continue;
      }
      const current = new Set(drafts.filter((d) => !isStale(m, d.criterion_id, d.drafted_from)).map((d) => targetOf(d.criterion_id)));
      chosen = all.filter((t) => m.basis.has(t) && !current.has(t));
      // What is left out of a submission that is drafted is said, so a missing overall summary isn't a surprise.
      if (chosen.length) for (const [t, why] of m.missing) plan.skipped.set(`${submissionId}/${t}`, why);
      if (!chosen.length) {
        plan.skipped.set(submissionId, m.basis.size ? "every draft is current: nothing has changed since it was drafted" : (m.missing.values().next().value ?? "nothing is marked yet"));
        continue;
      }
    }
    if (!chosen.length) continue;
    chosen = all.filter((t) => chosen.includes(t)); // in the rubric's order, the overall last
    const request = buildDraftRequest(material, m, chosen, model, FEEDBACK_PROMPT_VERSION, avoid);
    const [tokensIn, tokensOut, worst] = estimate(prices, request);
    const fallbackCost = fallback && !batch ? estimate(prices, { ...request, model: FALLBACK_MODEL })[2] : 0;
    plan.drafts.push({ submissionId, pseudonym: m.pseudonym, targets: chosen, avoid, marking: renderMarking(m, chosen, avoid), request, tokensIn, tokensOut, cost: worst * share, fallbackCost });
  }
  return plan;
}

const asDrafting = <T>(f: () => T): T => {
  try {
    return f();
  } catch (err) {
    if (err instanceof ReadingError) throw new DraftingError(err.message);
    throw err;
  }
};
async function asDraftingAsync<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (err) {
    if (err instanceof ReadingError) throw new DraftingError(err.message.replace("before reading", "before drafting"));
    throw err;
  }
}

// --- Sending -------------------------------------------------------------------------------------------

interface Current {
  request: ReadingRequest;
  marking: EducatorMarking;
  material: DraftMaterial;
  provider: string;
}

/** The request as it would be sent now, for the same targets; it must equal the confirmed one, or nothing is sent. */
async function rebuild(ws: Workspace, planned: PlannedDraft, plan: DraftPlan, model: string): Promise<Current> {
  const current = await currentDraft(ws, plan.withBrief, plan.withGuide, planned.submissionId, planned.targets, model, plan.provider, FEEDBACK_PROMPT_VERSION, planned.avoid);
  if (JSON.stringify(current.request) !== JSON.stringify({ ...planned.request, model })) {
    throw new UnapprovedText("the submission, brief, rubric or your marking changed after you confirmed what would be sent; nothing was sent, so draft it again");
  }
  return current;
}

/** The request for a submission's targets as it would be sent now; `promptVersion` is a batch's own, when collecting one sent with an earlier version. */
async function currentDraft(ws: Workspace, withBrief: boolean, withGuide: boolean, submissionId: string, targets: string[], model: string, provider: string | null, promptVersion = FEEDBACK_PROMPT_VERSION, avoid: Avoid = {}): Promise<Current> {
  const material = await draftMaterial(ws, withBrief, withGuide);
  const m = await educatorMarking(ws, submissionId);
  await requireComplete(ws, submissionId, m.text);
  for (const t of targets) if (!m.basis.has(t)) throw new DraftingError(m.missing.get(t) ?? `${t} can't be drafted`);
  if (!PROMPTS[promptVersion]) throw new DraftingError(`the instructions '${promptVersion}' aren't known to this version of Feedbacker`);
  return { request: buildDraftRequest(material, m, targets, model, promptVersion, avoid), marking: m, material, provider: provider ?? "unknown" };
}

const inputsOf = (c: Current): CallInputs => ({
  provider: c.provider,
  prompt_version: c.request.prompt.version,
  rubric_version: c.material.rubric.version,
  approval_id: c.marking.approval.id,
  approved_text_sha256: c.marking.approval.approved_text_sha256,
  brief_approval_id: c.material.briefApproval?.id ?? null,
  brief_sha256: c.material.briefApproval?.approved_text_sha256 ?? null,
});

export interface DraftResult {
  drafted: Map<string, FeedbackDraft[]>;
  failed: Map<string, string>;
  notRun: Map<string, string>;
  warnings: Map<string, string[]>;
  fallbacks: string[];
  spentUsd: number;
}
const emptyResult = (): DraftResult => ({ drafted: new Map(), failed: new Map(), notRun: new Map(), warnings: new Map(), fallbacks: [], spentUsd: 0 });

/** The AI's output must be a set of drafts; anything else is unparsed, never trusted. */
export function parseDraftResponse(data: unknown): ProxyResponse {
  const response = data as ProxyResponse;
  if (response.outcome !== "complete") return { ...response, parsed: null };
  const parsed = FeedbackOut.safeParse(response.parsed);
  return parsed.success ? { ...response, parsed: parsed.data } : { ...response, outcome: "unparsed", parsed: null };
}

export async function recordDraftCall(ws: Workspace, id: string, call: ModelCall, response: ProxyResponse | null, outcome: string, when: Date) {
  const record = await freePath(ws, `${FEEDBACK}/calls/${id}--${stampOf(when)}--${call.model_requested}`);
  await ws.writeJson(record, { outcome, call }, { private: true });
  if (response) await ws.writeJson(record.replace(`${FEEDBACK}/calls/`, `${FEEDBACK}/raw/`), JSON.parse(response.raw_json), { private: true });
}

/** The record of a call that was forwarded and then failed: there is no response to keep. */
export function failedCall(inputs: CallInputs, model: string, fallbackFrom: string | null, err: ProviderError, when: Date, producedBy: "live" | "batch"): ModelCall {
  return ModelCall.parse({
    ...inputs,
    model_requested: model,
    model_reported: null,
    request_id: null,
    fallback_from: fallbackFrom,
    request_sha256: err.requestSha256,
    response_sha256: null,
    stop_reason: null,
    usage: TokenUsage.parse({}),
    produced_by: producedBy,
    timestamp: when.toISOString(),
    error: err.message,
  });
}

/** A complete response's drafts, one per target asked for, stored over those targets' earlier drafts. */
async function keepDrafts(ws: Workspace, current: Current, targets: string[], out: FeedbackOut, call: ModelCall, result: DraftResult, when: Date) {
  const m = current.marking;
  const id = m.submissionId;
  const warnings: string[] = [];
  const token = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const byId = new Map(Object.entries(out.criteria));
  const extra = [...byId.keys()].filter((c) => !targets.includes(c));
  if (extra.length) warnings.push(`ignored drafts for criteria not asked for: ${extra.join(", ")}`);
  const drafts: FeedbackDraft[] = [];
  targets.forEach((target, i) => {
    let text = (target === OVERALL ? out.overall : byId.get(target))?.trim();
    if (text && strayEnding(text)) {
      // Debris from the reply's format after a complete last sentence: removed, and said.
      text = withoutStrayEnding(text);
      warnings.push(`${target === OVERALL ? "the overall summary" : `the draft for criterion '${target}'`} ended with a stray quotation mark and comma, which were removed`);
    }
    if (text && endsMidSentence(text)) warnings.push(`${target === OVERALL ? "the overall summary" : `the draft for criterion '${target}'`} seems to end mid-sentence; check it, or draft it again`);
    if (!text) {
      warnings.push(`${target === OVERALL ? "no overall summary came back" : `no draft came back for criterion '${target}'`}; plan the drafts again to draft it`);
      return;
    }
    drafts.push(
      FeedbackDraft.parse({
        id: `fd-${id}-${String(i + 1).padStart(2, "0")}-${token}`,
        submission_id: id,
        criterion_id: target === OVERALL ? null : target,
        text,
        drafted_from: m.basis.get(target)!,
        guide_version: current.material.guide?.version ?? null,
        call,
        provenance: {
          source: `model call ${call.request_id || call.request_sha256.slice(0, 16)}`,
          transformation: "generated",
          actor: { kind: "model", label: call.model_reported || call.model_requested },
          timestamp: when.toISOString(),
          // What it was drafted from, and the request the educator approved.
          input_hashes: [...new Set([m.approval.approved_text_sha256, m.basis.get(target)!, requestKey(current.request), ...(call.brief_sha256 ? [call.brief_sha256] : []), ...(current.material.guide ? [current.material.guide.sha256] : [])])].sort(),
        },
      }),
    );
  });
  if (drafts.length) await replaceTargets(ws, draftsPath(id), "drafts", id, await loadDrafts(ws, id), drafts, when); // a drafts file that doesn't load fails clearly, never replaced
  result.drafted.set(id, drafts);
  if (warnings.length) result.warnings.set(id, warnings);
}

class SpendLimitReached extends Error {}

/** Drafts that came back but couldn't be kept (its drafts file doesn't load): reported, with the call already recorded. */
function keepFailed(err: unknown, id: string, result: DraftResult) {
  if (!(err instanceof WorkspaceError)) throw err;
  result.failed.set(id, `the drafts came back but weren't kept: ${err.message}`);
}

/** Send a plan one submission at a time, each request rebuilt and checked against what was confirmed just before it is sent. */
export async function runDrafts(ws: Workspace, plan: DraftPlan, options: { proxy: ReadingProxy; now?: () => Date; onProgress?: (p: { submissionId: string; index: number; total: number }) => void }): Promise<DraftResult> {
  if (plan.batch) throw new DraftingError("this plan is for a batch; send it with sendDraftBatch");
  const now = options.now ?? (() => new Date());
  const result = emptyResult();
  const log: Record<string, unknown>[] = [];
  const started = now();
  try {
    let runId: string;
    try {
      runId = (await options.proxy.openRun(plan.capUsd, draftsCost(plan))).id;
    } catch (err) {
      if (err instanceof ProxyRefusal || err instanceof WorkspaceError) throw new DraftingError(err.message);
      throw err;
    }
    for (const [i, planned] of plan.drafts.entries()) {
      if (planned.cost > plan.capUsd - result.spentUsd) {
        for (const later of plan.drafts.slice(i)) result.notRun.set(later.submissionId, `the $${pyFormatG(plan.capUsd)} spend limit would be exceeded ($${result.spentUsd.toFixed(2)} spent)`);
        break;
      }
      options.onProgress?.({ submissionId: planned.submissionId, index: i, total: plan.drafts.length });
      try {
        await draftOne(ws, planned, plan, options.proxy, runId, result, log, now);
      } catch (err) {
        if (!(err instanceof SpendLimitReached)) throw err;
        for (const later of plan.drafts.slice(i)) result.notRun.set(later.submissionId, err.message);
        break;
      }
    }
  } finally {
    await writeDraftLog(ws, started, plan, null, result, log);
  }
  return result;
}

async function draftOne(ws: Workspace, planned: PlannedDraft, plan: DraftPlan, proxy: ReadingProxy, runId: string, result: DraftResult, log: Record<string, unknown>[], now: () => Date) {
  const id = planned.submissionId;
  let model = plan.model;
  let fallbackFrom: string | null = null;
  while (true) {
    let current: Current | null = null;
    let response: ProxyResponse;
    try {
      current = await rebuild(ws, planned, plan, model);
      response = parseDraftResponse(await proxy.read(runId, current.request));
    } catch (err) {
      if (err instanceof UnapprovedText || err instanceof WorkspaceError || err instanceof DraftingError) {
        result.failed.set(id, err.message);
        return;
      }
      if (err instanceof ProviderError) {
        if (err.requestSha256 && current) await recordDraftCall(ws, id, failedCall(inputsOf(current), model, fallbackFrom, err, now(), "live"), null, "provider_error", now());
        if (err.fatal) throw new DraftingError(err.message);
        result.failed.set(id, err.message);
        return;
      }
      if (err instanceof ProxyRefusal) {
        if (err.type === "key" || err.type === "run") throw new DraftingError(err.message);
        if (err.type === "spend") throw new SpendLimitReached(err.message);
        result.failed.set(id, err.message);
        return;
      }
      throw err;
    }
    result.spentUsd += response.cost_usd;
    const call = callRecord(response, inputsOf(current), model, fallbackFrom, now());
    await recordDraftCall(ws, id, call, response, response.outcome, now());
    log.push({ submission_id: id, targets: planned.targets, model, outcome: response.outcome, request_id: response.request_id, usage: call.usage, cost_usd: pyRound(response.cost_usd, 6) });
    if (response.outcome === "refused" && plan.fallbackModel && fallbackFrom === null) {
      if (planned.fallbackCost > plan.capUsd - result.spentUsd) {
        result.failed.set(id, `${model} declined, and the fallback would exceed the spend limit`);
        return;
      }
      fallbackFrom = model;
      model = plan.fallbackModel;
      result.fallbacks.push(id);
      continue;
    }
    if (response.outcome === "refused") result.failed.set(id, `${model} declined to draft this feedback`);
    else if (response.outcome !== "complete") result.failed.set(id, `the drafts were incomplete (${response.outcome}, stop reason: ${response.stop_reason})`);
    else await keepDrafts(ws, current, planned.targets, response.parsed as FeedbackOut, call, result, now()).catch((err) => keepFailed(err, id, result));
    return;
  }
}

// --- Batches -------------------------------------------------------------------------------------------

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const BatchId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

/** A drafting batch as the workspace records it: what was sent, and whether its results have been collected. */
export const SentDraftBatch = z.strictObject({
  id: BatchId,
  run_id: z.string(),
  sent_at: z.string(),
  provider: z.string(),
  model: z.string(),
  prompt_version: z.string().default("feedback-v1"), // the instructions the batch was sent with (batches sent before it was recorded were all feedback-v1)
  with_brief: z.boolean(),
  with_guide: z.boolean().default(false),
  guide_version: z.int().nullable().default(null), // the guide every request in the batch was sent with
  cap_usd: z.number(),
  estimated_usd: z.number(),
  items: z
    .array(
      z.strictObject({
        custom_id: z.string(),
        submission_id: z.string(),
        targets: z.array(z.string()).min(1),
        avoid: z.record(z.string(), z.array(z.string())).default({}),
        request_key: Hash,
        request_sha256: Hash,
        rubric_version: z.string(),
        approval_id: z.string(),
        approved_text_sha256: Hash,
        brief_approval_id: z.string().nullable(),
        brief_sha256: Hash.nullable(),
      }),
    )
    .min(1),
  collected_at: z.string().nullable(),
});
export type SentDraftBatch = z.output<typeof SentDraftBatch>;

const draftBatchPath = (id: string) => `${FEEDBACK_BATCHES}/${id}.json`;
const Sent = BatchProgress.extend({ items: z.array(z.object({ custom_id: z.string(), request_sha256: Hash })) });
const Results = z.object({
  id: BatchId,
  items: z.array(z.looseObject({ custom_id: z.string(), request_sha256: Hash, cost_usd: z.number(), failed: z.string().optional(), message: z.string().optional() })),
});

/** The drafting batches sent from this workspace whose results haven't been collected yet, oldest first. */
export async function pendingDraftBatches(ws: Workspace): Promise<SentDraftBatch[]> {
  if (!(await ws.exists(FEEDBACK_BATCHES))) return [];
  const out: SentDraftBatch[] = [];
  for (const e of await ws.fs.list(FEEDBACK_BATCHES)) {
    if (e.kind !== "file" || !e.name.endsWith(".json")) continue;
    const parsed = SentDraftBatch.safeParse(await ws.readJson(`${FEEDBACK_BATCHES}/${e.name}`));
    if (!parsed.success) throw new WorkspaceError(`${FEEDBACK_BATCHES}/${e.name} is not a valid batch record`);
    if (!parsed.data.collected_at) out.push(parsed.data);
  }
  return out.sort((a, b) => a.sent_at.localeCompare(b.sent_at));
}

/** Send a batch plan as one batch, each request rebuilt and checked against what was confirmed. One batch at a time per workspace. */
export async function sendDraftBatch(ws: Workspace, plan: DraftPlan, options: { proxy: ReadingProxy; now?: () => Date }): Promise<{ batch: SentDraftBatch | null; result: DraftResult }> {
  if (!plan.batch) throw new DraftingError("this plan isn't for a batch; send it with runDrafts");
  const now = options.now ?? (() => new Date());
  const waiting = await pendingDraftBatches(ws);
  if (waiting.length) throw new DraftingError(`a batch sent on ${waiting[0].sent_at.slice(0, 10)} is still waiting; collect its drafts or cancel it first`);
  const result = emptyResult();
  const log: Record<string, unknown>[] = [];
  const started = now();
  let runId: string;
  try {
    runId = (await options.proxy.openRun(plan.capUsd, draftsCost(plan))).id;
  } catch (err) {
    if (err instanceof ProxyRefusal || err instanceof WorkspaceError) throw new DraftingError(err.message);
    throw err;
  }
  const toSend: { planned: PlannedDraft; current: Current }[] = [];
  let committed = 0;
  for (const [i, planned] of plan.drafts.entries()) {
    if (committed + planned.cost > plan.capUsd) {
      for (const later of plan.drafts.slice(i)) result.notRun.set(later.submissionId, `the $${pyFormatG(plan.capUsd)} spend limit would be exceeded`);
      break;
    }
    try {
      toSend.push({ planned, current: await rebuild(ws, planned, plan, plan.model) });
      committed += planned.cost;
    } catch (err) {
      if (err instanceof UnapprovedText || err instanceof WorkspaceError || err instanceof DraftingError) result.failed.set(planned.submissionId, err.message);
      else throw err;
    }
  }
  if (!toSend.length) {
    await writeDraftLog(ws, started, plan, null, result, log);
    return { batch: null, result };
  }
  let sent: z.output<typeof Sent>;
  try {
    sent = Sent.parse(await options.proxy.sendBatch(runId, toSend.map((s) => s.current.request), ws.registration.registration_id));
  } catch (err) {
    if (err instanceof ProxyRefusal) {
      const message = err.message.replace(/^request (\d+): /, (_, n: string) => `${toSend[Number(n) - 1]?.planned.submissionId ?? `request ${n}`}: `);
      if (err.type === "spend") {
        for (const s of toSend) result.notRun.set(s.planned.submissionId, message);
        await writeDraftLog(ws, started, plan, null, result, log);
        return { batch: null, result };
      }
      throw new DraftingError(`nothing was sent: ${message}`);
    }
    if (err instanceof ProviderError) {
      for (const s of toSend) result.failed.set(s.planned.submissionId, err.message);
      await writeDraftLog(ws, started, plan, null, result, log);
      if (err.fatal) throw new DraftingError(err.message);
      return { batch: null, result };
    }
    if (err instanceof z.ZodError) throw new DraftingError("the proxy's reply to the batch was not understood; check the proxy before sending again");
    throw err;
  }
  if (sent.items.length !== toSend.length || sent.items.some((item, i) => item.custom_id !== `r${i + 1}`)) {
    await options.proxy.cancelBatch(sent.id).catch(() => {});
    throw new DraftingError(`the proxy's reply didn't match the batch sent, so it was cancelled (${sent.id}); draft again`);
  }
  const batch = SentDraftBatch.parse({
    id: sent.id,
    run_id: runId,
    sent_at: started.toISOString(),
    provider: plan.provider ?? "unknown",
    model: plan.model,
    prompt_version: toSend[0].current.request.prompt.version, // every drafting request is sent with the same instructions
    with_brief: plan.withBrief,
    with_guide: plan.withGuide,
    guide_version: plan.guideVersion,
    cap_usd: plan.capUsd,
    estimated_usd: pyRound(draftsCost(plan), 6),
    items: toSend.map(({ planned, current }, i) => ({
      custom_id: sent.items[i].custom_id,
      submission_id: planned.submissionId,
      targets: planned.targets,
      avoid: planned.avoid,
      request_key: requestKey(current.request),
      request_sha256: sent.items[i].request_sha256,
      ...(({ provider: _p, prompt_version: _v, ...rest }) => rest)(inputsOf(current)),
    })),
    collected_at: null,
  });
  try {
    await ws.writeJson(draftBatchPath(batch.id), batch, { private: true });
  } catch (err) {
    await options.proxy.cancelBatch(batch.id).catch(() => {});
    throw new DraftingError(`the batch was sent but couldn't be recorded in the workspace, so it was cancelled (${batch.id}): ${(err as Error).message}`);
  }
  for (const item of batch.items) log.push({ submission_id: item.submission_id, targets: item.targets, model: plan.model, outcome: "batch_submitted", batch_id: batch.id, request_sha256: item.request_sha256 });
  await writeDraftLog(ws, started, plan, batch, result, log);
  return { batch, result };
}

/** Collect an ended drafting batch: each response kept if what would be sent now is exactly what was sent, and every call recorded. */
export async function collectDraftBatch(ws: Workspace, proxy: ReadingProxy, id: string, options: { now?: () => Date } = {}): Promise<DraftResult> {
  const now = options.now ?? (() => new Date());
  const batch = (await pendingDraftBatches(ws)).find((b) => b.id === id);
  if (!batch) throw new DraftingError(`no drafting batch ${id} is waiting in this workspace`);
  let results: z.output<typeof Results>;
  try {
    results = Results.parse(await proxy.batchResults(id));
  } catch (err) {
    if (err instanceof ProxyRefusal || err instanceof ProviderError || err instanceof WorkspaceError) throw new DraftingError(err.message);
    if (err instanceof z.ZodError) throw new DraftingError("the proxy's reply about the batch was not understood");
    throw err;
  }
  const byId = new Map(results.items.map((r) => [r.custom_id, r]));
  const result = emptyResult();
  const log: Record<string, unknown>[] = [];
  const started = now();
  for (const item of batch.items) {
    const sid = item.submission_id;
    const r = byId.get(item.custom_id);
    if (!r || r.request_sha256 !== item.request_sha256) {
      result.failed.set(sid, "no drafts came back for it; draft it again");
      continue;
    }
    const inputs: CallInputs = { provider: batch.provider, prompt_version: batch.prompt_version, rubric_version: item.rubric_version, approval_id: item.approval_id, approved_text_sha256: item.approved_text_sha256, brief_approval_id: item.brief_approval_id, brief_sha256: item.brief_sha256 };
    if (r.failed) {
      const message = r.message ?? `the request ${r.failed} in the batch`;
      await recordDraftCall(ws, sid, failedCall(inputs, batch.model, null, new ProviderError(message, false, item.request_sha256), now(), "batch"), null, "provider_error", now());
      result.failed.set(sid, `${message}; draft it again, one at a time`);
      continue;
    }
    const response = parseDraftResponse(r);
    result.spentUsd += response.cost_usd;
    const call = callRecord(response, inputs, batch.model, null, now(), "batch");
    await recordDraftCall(ws, sid, call, response, response.outcome, now());
    log.push({ submission_id: sid, targets: item.targets, model: batch.model, outcome: response.outcome, batch_id: id, request_id: response.request_id, usage: call.usage, cost_usd: pyRound(response.cost_usd, 6) });
    let current: Current | null = null;
    try {
      // Rebuilt with the batch's own instructions, so a batch sent before they changed can still be collected.
      current = await currentDraft(ws, batch.with_brief, batch.with_guide, sid, item.targets, batch.model, batch.provider, batch.prompt_version, item.avoid);
    } catch (err) {
      if (!(err instanceof UnapprovedText || err instanceof WorkspaceError || err instanceof DraftingError)) throw err;
    }
    if (response.outcome === "refused") result.failed.set(sid, `${batch.model} declined to draft it; draft it again one at a time, and the fallback model is asked if it declines again`);
    else if (response.outcome !== "complete") result.failed.set(sid, `the drafts were incomplete (${response.outcome}, stop reason: ${response.stop_reason})`);
    else if (!current || requestKey(current.request) !== item.request_key) {
      result.failed.set(sid, "the submission, brief, rubric or your marking changed after the batch was sent, so its drafts weren't kept; draft it again");
    } else await keepDrafts(ws, current, item.targets, response.parsed as FeedbackOut, call, result, now()).catch((err) => keepFailed(err, sid, result));
  }
  await ws.writeJson(draftBatchPath(id), { ...batch, collected_at: now().toISOString() }, { private: true });
  await writeDraftLog(ws, started, null, batch, result, log);
  return result;
}

async function writeDraftLog(ws: Workspace, started: Date, plan: DraftPlan | null, batch: SentDraftBatch | null, result: DraftResult, log: Record<string, unknown>[]) {
  await ws.writeJson(
    await freePath(ws, `${FEEDBACK}/runs/${stampOf(started)}`),
    {
      started: isoformat(started),
      provider: plan?.provider ?? batch?.provider ?? null,
      model: plan?.model ?? batch?.model ?? null,
      fallback_model: plan?.fallbackModel ?? null,
      prompt_version: batch?.prompt_version ?? FEEDBACK_PROMPT_VERSION,
      with_brief: plan?.withBrief ?? batch?.with_brief ?? null,
      guide_version: plan ? plan.guideVersion : (batch?.guide_version ?? null),
      batch: batch ? { id: batch.id, action: plan ? "sent" : "collected" } : null,
      cap_usd: plan?.capUsd ?? batch?.cap_usd ?? null,
      estimated_usd: plan ? pyRound(draftsCost(plan), 6) : null,
      spent_usd: pyRound(result.spentUsd, 6),
      calls: log,
      drafted: [...result.drafted.keys()].sort(),
      failed: Object.fromEntries(result.failed),
      not_run: Object.fromEntries(result.notRun),
      fallbacks: result.fallbacks,
    },
    { private: true },
  );
}
