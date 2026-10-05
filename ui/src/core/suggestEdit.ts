/**
 * Suggesting an edit to the educator's flagged feedback (ADR 0006, amended): when a check flags a piece of recorded
 * feedback, the AI suggests the smallest edit that deals with the flags, keeping the educator's own wording.
 *
 * What is sent, for one piece of feedback of one submission, only when the educator asks: the instructions
 * (`feedback-edit-v1`), the rubric, the educator's marking of that criterion (or, for the overall feedback, the overall
 * mark and comment and each criterion's level and mark), and their recorded feedback with the checks' unaccepted flags
 * on it. Never the submission, the brief, the guide, their other feedback, or another student's material. Only recorded
 * feedback is sent, because it is anonymised when it is recorded. The educator sees exactly what will be sent before
 * confirming; the request is rebuilt just before it is sent, and must equal the one confirmed.
 *
 * The suggestion is kept as a draft that names the feedback it edits (`edited_from`), in `feedback/suggestions`; it
 * never replaces the educator's text. Feedback recorded from it is derived from the AI (drafting.ts's recordFeedback).
 */

import * as z from "zod";
import { incompleteIn } from "./anonymise.ts";
import { UnapprovedText } from "./boundary.ts";
import {
  requireCommentsComplete,
  DraftingError,
  educatorMarking,
  type EducatorMarking,
  failedCall,
  feedbackFlags,
  loadFeedback,
  loadSuggestions,
  OVERALL,
  recordDraftCall,
  suggestionsPath,
  targetOf,
} from "./drafting.ts";
import { endsMidSentence, strayEnding, withoutStrayEnding, type Flag } from "./feedbackChecks.ts";
import { criterionMax, entryMark } from "./marks.ts";
import { FeedbackDraft } from "./models.ts";
import { PROMPTS } from "./prompts.ts";
import { pyFormatG, pyRound } from "./pytext.ts";
import { callRecord, type CallInputs, DEFAULT_CAP_USD, DEFAULT_MODEL, estimate, priceOf, type ProxyResponse, ReadingError, type ReadingProxy, type ReadingRequest, renderRubric, requestKey } from "./reading.ts";
import { sha256Text } from "./text.ts";
import { ProviderError, ProxyRefusal, type Workspace, WorkspaceError } from "./workspace.ts";

export const SUGGEST_PROMPT_VERSION = "feedback-edit-v1";
const MAX_SUGGEST_TOKENS = 2000;

/** What the AI returns: the whole feedback, edited. */
export const SuggestOut = z.strictObject({ text: z.string() });
const SUGGEST_SCHEMA = { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false };

const levelLine = (m: EducatorMarking, criterionId: string) => {
  const c = m.rubric.criteria.find((x) => x.id === criterionId)!;
  const e = m.entries.get(criterionId)!;
  const level = c.levels.find((l) => l.id === e.level_id);
  const mark = entryMark(c, e);
  const max = criterionMax(c);
  return { c, e, level: `${level?.label ?? e.level_id} (level id ${e.level_id})`, mark: `${mark === null ? "none" : pyFormatG(mark)}${max !== null ? ` out of ${pyFormatG(max)}` : ""}` };
};

/** The educator's marking for one target, as it is sent: a criterion's level, mark and comment; or the overall mark and comment, and each criterion's level and mark. */
export function renderEditMarking(m: EducatorMarking, target: string): string {
  if (target !== OVERALL) {
    const { c, e, level, mark } = levelLine(m, target);
    return [`The feedback is on criterion: ${c.title} (id ${c.id})`, `Level: ${level}`, `Mark: ${mark}`, `The educator's comment: ${e.comment?.trim() ? e.comment.trim() : "(none)"}`].join("\n");
  }
  const lines = ["The feedback is the overall feedback.", `Overall mark: ${pyFormatG(m.overall!.mark)} out of 100`, `The educator's overall comment: ${m.overall!.comment?.trim() ? m.overall!.comment.trim() : "(none)"}`];
  for (const c of m.rubric.criteria) {
    const { level, mark } = levelLine(m, c.id);
    lines.push("", `Criterion: ${c.title} (id ${c.id})`, `Level: ${level}`, `Mark: ${mark}`);
  }
  return lines.join("\n");
}

/** The educator's recorded feedback, then the checks' flags on it, as they are sent. */
export function renderEditFeedback(text: string, flags: Flag[]): string {
  return [text, "", "What Feedbacker's checks flagged in it:", ...flags.map((f) => `- ${f.message.replace(/[.!?]$/, "")}.`)].join("\n");
}

export function buildSuggestRequest(m: EducatorMarking, target: string, feedbackText: string, flags: Flag[], model: string): ReadingRequest {
  const marking = renderEditMarking(m, target);
  const feedback = renderEditFeedback(feedbackText, flags);
  return {
    model,
    max_output_tokens: MAX_SUGGEST_TOKENS,
    prompt: { version: SUGGEST_PROMPT_VERSION, instructions: PROMPTS[SUGGEST_PROMPT_VERSION] },
    blocks: [
      { kind: "rubric", heading: "RUBRIC", text: renderRubric(m.rubric), approved_sha256: null },
      // Each approved as exactly this text: the educator is shown both before confirming.
      { kind: "marking", heading: "THE EDUCATOR'S MARKING", text: marking, approved_sha256: sha256Text(marking) },
      { kind: "feedback", heading: "THE EDUCATOR'S FEEDBACK", text: feedback, approved_sha256: sha256Text(feedback) },
    ],
    output_schema: SUGGEST_SCHEMA,
  };
}

// --- Planning ----------------------------------------------------------------------------------------------

export interface SuggestPlan {
  submissionId: string;
  target: string;
  model: string;
  capUsd: number;
  provider: string | null;
  marking: string; // exactly what is sent of the educator's marking
  feedback: string; // exactly what is sent of their feedback, with the flags
  editedFrom: string; // the SHA-256 of the recorded feedback it edits
  request: ReadingRequest;
  cost: number; // a worst case
}

interface Current {
  request: ReadingRequest;
  marking: EducatorMarking;
  feedbackSha: string;
}

/** The request for one target's recorded feedback as it would be sent now: refused unless it is recorded, current enough to mark against, and flagged. */
async function currentSuggestion(ws: Workspace, submissionId: string, target: string, model: string): Promise<Current> {
  const m = await educatorMarking(ws, submissionId);
  if (!m.basis.has(target)) throw new DraftingError(m.missing.get(target) ?? `'${target}' is not a criterion of the source rubric`);
  const feedback = (await loadFeedback(ws, submissionId)).find((f) => targetOf(f.criterion_id) === target);
  if (!feedback) throw new DraftingError("record the feedback first: only recorded feedback, which is anonymised, is sent");
  const open = (await feedbackFlags(ws, submissionId)).find((x) => x.target === target)?.open ?? [];
  if (!open.length) throw new DraftingError("nothing is flagged in this feedback, so there is nothing to suggest an edit for");
  try {
    await requireCommentsComplete(ws, m, [target]); // the comment sent with it, as a later rule would anonymise it
  } catch (err) {
    if (err instanceof UnapprovedText) throw new DraftingError(err.message);
    throw err;
  }
  if (await incompleteIn(ws, feedback.text)) throw new DraftingError("your feedback contains something the anonymisation rules or pseudonym key now redact; record it again (nothing is sent until then)");
  return { request: buildSuggestRequest(m, target, feedback.text, open, model), marking: m, feedbackSha: sha256Text(feedback.text) };
}

/** Everything that would be sent to suggest an edit to one piece of feedback, with a worst-case estimate; sends nothing. */
export async function planSuggestion(ws: Workspace, proxy: ReadingProxy, submissionId: string, target: string, options: { model?: string; capUsd?: number } = {}): Promise<SuggestPlan> {
  if (ws.manifest.workspace_type !== "marking") throw new DraftingError("only a marking workspace has feedback to edit");
  const model = options.model ?? DEFAULT_MODEL;
  const capUsd = options.capUsd ?? DEFAULT_CAP_USD;
  const { prices, provider } = await proxy.health();
  try {
    priceOf(prices, model);
  } catch (err) {
    if (err instanceof ReadingError) throw new DraftingError(err.message);
    throw err;
  }
  const current = await currentSuggestion(ws, submissionId, target, model);
  const [, , worst] = estimate(prices, current.request);
  const [, marking, feedback] = current.request.blocks;
  return { submissionId, target, model, capUsd, provider, marking: marking.text, feedback: feedback.text, editedFrom: current.feedbackSha, request: current.request, cost: worst };
}

// --- Sending -------------------------------------------------------------------------------------------------

export interface SuggestResult {
  suggestion: FeedbackDraft | null;
  warnings: string[];
  spentUsd: number;
}

/** Send a confirmed plan: rebuilt and checked against what was confirmed, then the suggestion kept beside the feedback, never in place of it. */
export async function runSuggestion(ws: Workspace, plan: SuggestPlan, options: { proxy: ReadingProxy; now?: () => Date }): Promise<SuggestResult> {
  const now = options.now ?? (() => new Date());
  const id = plan.submissionId;
  const current = await currentSuggestion(ws, id, plan.target, plan.model);
  if (JSON.stringify(current.request) !== JSON.stringify(plan.request)) {
    throw new DraftingError("your marking or feedback, or its flags, changed after you confirmed what would be sent; nothing was sent, so ask again");
  }
  const inputs: CallInputs = { provider: plan.provider ?? "unknown", prompt_version: SUGGEST_PROMPT_VERSION, rubric_version: current.marking.rubric.version, approval_id: current.marking.approval.id, approved_text_sha256: current.marking.approval.approved_text_sha256, brief_approval_id: null, brief_sha256: null };
  let response: ProxyResponse;
  try {
    const runId = (await options.proxy.openRun(plan.capUsd, plan.cost)).id;
    response = parseSuggestResponse(await options.proxy.read(runId, current.request));
  } catch (err) {
    if (err instanceof ProviderError) {
      if (err.requestSha256) await recordDraftCall(ws, id, failedCall(inputs, plan.model, null, err, now(), "live"), null, "provider_error", now());
      throw new DraftingError(err.message);
    }
    if (err instanceof ProxyRefusal || err instanceof WorkspaceError) throw new DraftingError(err.message);
    throw err;
  }
  const when = now();
  const call = callRecord(response, inputs, plan.model, null, when);
  await recordDraftCall(ws, id, call, response, response.outcome, when);
  const spentUsd = pyRound(response.cost_usd, 6);
  const out = response.outcome === "complete" ? (response.parsed as z.output<typeof SuggestOut>) : null;
  let text = out?.text.trim() ?? "";
  if (!text) return { suggestion: null, warnings: [response.outcome === "complete" ? "no suggestion came back; ask again" : `no suggestion came back (${response.outcome}); ask again`], spentUsd };
  const warnings: string[] = [];
  if (strayEnding(text)) {
    text = withoutStrayEnding(text);
    warnings.push("the suggestion ended with a stray quotation mark and comma, which were removed");
  }
  if (endsMidSentence(text)) warnings.push("the suggestion seems to end mid-sentence; check it");
  const token = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const suggestion = FeedbackDraft.parse({
    id: `fs-${id}-${token}`,
    submission_id: id,
    criterion_id: plan.target === OVERALL ? null : plan.target,
    text,
    drafted_from: current.marking.basis.get(plan.target)!,
    guide_version: null,
    edited_from: current.feedbackSha,
    call,
    provenance: {
      source: `model call ${call.request_id || call.request_sha256.slice(0, 16)}`,
      transformation: "generated",
      actor: { kind: "model", label: call.model_reported || call.model_requested },
      timestamp: when.toISOString(),
      // What it was suggested from, and the request the educator approved.
      input_hashes: [...new Set([current.marking.approval.approved_text_sha256, current.marking.basis.get(plan.target)!, current.feedbackSha, requestKey(current.request)])].sort(),
    },
  });
  const path = suggestionsPath(id);
  const kept = await loadSuggestions(ws, id); // a file that doesn't load fails clearly, never replaced
  try {
    await ws.writeJson(path, [...kept, suggestion], { private: true });
  } finally {
    await ws.secure().catch(() => {});
  }
  return { suggestion, warnings, spentUsd };
}

/** The AI's output must be one piece of text; anything else is unparsed, never trusted. */
export function parseSuggestResponse(data: unknown): ProxyResponse {
  const response = data as ProxyResponse;
  if (response.outcome !== "complete") return { ...response, parsed: null };
  const parsed = SuggestOut.safeParse(response.parsed);
  return parsed.success ? { ...response, parsed: parsed.data } : { ...response, outcome: "unparsed", parsed: null };
}
