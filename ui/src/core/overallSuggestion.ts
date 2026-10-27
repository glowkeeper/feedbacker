/**
 * Suggesting the moderator's overall comment (ADR 0011): when every sampled submission has a verdict, the AI suggests one short paragraph
 * on the sample, for the moderation record and the moderation form.
 *
 * What is sent, only when asked: the instructions (`overall-comment-v1`) and one block: how the sample was chosen and, for each sampled
 * submission, the original marker's overall mark, the overall mark the moderator's criterion marks implied, the mark they suggested, their
 * verdict and their comment on it. Never a rubric, a submission, the brief, the AI reading or the marker's comments. The moderator sees exactly what
 * will be sent before confirming; the request is rebuilt just before it is sent, and must equal the one confirmed. The suggestion is shown, and
 * kept as a record of the call; it never becomes the overall comment on its own.
 */

import * as z from "zod";
import { apply, detect, loadRules } from "./anonymise.ts";
import { DraftingError, failedCall } from "./drafting.ts";
import { type ModelCall, type OriginalAssessment, type SubmissionVerdict } from "./models.ts";
import { PROMPTS } from "./prompts.ts";
import { pyFormatG, pyRound } from "./pytext.ts";
import { callRecord, type CallInputs, DEFAULT_CAP_USD, DEFAULT_MODEL, estimate, priceOf, type ProxyResponse, ReadingError, type ReadingProxy, type ReadingRequest } from "./reading.ts";
import { loadRequest } from "./request.ts";
import { sha256Text } from "./text.ts";
import { currentMarking, loadVerdict, verdictStands } from "./verdict.ts";
import { recordSuggestionCall } from "./verdictSuggestion.ts";
import { ProviderError, ProxyRefusal, type Workspace, WorkspaceError } from "./workspace.ts";

export const OVERALL_PROMPT_VERSION = "overall-comment-v1";
const MAX_OVERALL_TOKENS = 1500;

/** What the AI returns: the overall comment. */
export const OverallOut = z.strictObject({ comment: z.string() });
const OVERALL_SCHEMA = { type: "object", properties: { comment: { type: "string" } }, required: ["comment"], additionalProperties: false };

const outOf100 = (n: number | null) => (n === null ? "none given" : `${pyFormatG(n)} out of 100`);

/** The sample's moderation as it is sent: only marks, verdicts and the moderator's own comments. */
export function renderSample(options: {
  note: string | null;
  submissions: { id: string; pseudonym: string; markings: OriginalAssessment[]; verdict: SubmissionVerdict }[];
}): string {
  const lines = [`The moderation of ${options.submissions.length} sampled submission${options.submissions.length === 1 ? "" : "s"}.`, `How the sample was chosen: ${options.note?.trim() || "not recorded"}`];
  for (const s of options.submissions) {
    lines.push("", `Submission ${s.id} (${s.pseudonym}):`);
    for (const m of s.markings) lines.push(`${s.markings.length > 1 ? `The original marker (${m.marker_label})'s` : "The original marker's"} overall mark: ${outOf100(m.overall_mark)}`);
    lines.push(`The moderator's overall mark, implied by their criterion marks: ${s.verdict.criteria_mark === null ? "not worked out" : outOf100(s.verdict.criteria_mark)}`);
    lines.push(`The moderator's suggested mark: ${s.verdict.suggested_mark === null ? "none" : outOf100(s.verdict.suggested_mark)}`);
    lines.push(`Verdict: ${s.verdict.verdict}`, `The moderator's comment: ${s.verdict.comment?.trim() ? s.verdict.comment.trim() : "(none)"}`);
  }
  return lines.join("\n");
}

/** What would be sent now, refused (saying what to do) unless every sampled submission has a verdict that still stands. */
async function currentSample(ws: Workspace): Promise<{ text: string; count: number }> {
  if (ws.manifest.workspace_type === "marking") throw new DraftingError("only a moderation has an overall comment on a sample");
  const request = await loadRequest(ws);
  const submissions: Parameters<typeof renderSample>[0]["submissions"] = [];
  const missing: string[] = [];
  const stale: string[] = [];
  for (const s of request.sample) {
    const verdict = await loadVerdict(ws, s.submission_id);
    if (!verdict) {
      missing.push(s.submission_id);
      continue;
    }
    if (!(await verdictStands(ws, s.submission_id, verdict))) {
      stale.push(s.submission_id);
      continue;
    }
    const markings = (await currentMarking(ws, s.submission_id)).filter((m) => m.overall_mark !== null);
    submissions.push({ id: s.submission_id, pseudonym: s.pseudonym, markings, verdict });
  }
  if (missing.length) throw new DraftingError(`record a verdict on every sampled submission first: the overall comment rests on them (still to do: ${missing.join(", ")})`);
  if (stale.length) throw new DraftingError(`a verdict was given on marking, text, rubric or marks that have since changed; check it and record it again first (${stale.join(", ")})`);
  // What is sent is anonymised now, with the key and rules as they are: the note on how the sample was chosen is free text that nothing has anonymised, and the verdict
  // comments may now contain something a later rule redacts. Any new token is kept, so the same text is sent each time.
  const key = await ws.readKey();
  const rules = await loadRules(ws);
  const raw = renderSample({ note: request.context.sample_note ?? null, submissions });
  const tokens = key.tokens.length;
  const text = apply(raw, detect(raw, key, rules), key)[0];
  if (key.tokens.length !== tokens) await ws.writeKey(key);
  return { text, count: submissions.length };
}

export function buildOverallRequest(sample: string, model: string): ReadingRequest {
  return {
    model,
    max_output_tokens: MAX_OVERALL_TOKENS,
    prompt: { version: OVERALL_PROMPT_VERSION, instructions: PROMPTS[OVERALL_PROMPT_VERSION] },
    // Approved as exactly this text: the moderator is shown it before confirming.
    blocks: [{ kind: "marking", heading: "THE MODERATION OF THE SAMPLE", text: sample, approved_sha256: sha256Text(sample) }],
    output_schema: OVERALL_SCHEMA,
  };
}

export interface OverallPlan {
  model: string;
  capUsd: number;
  provider: string | null;
  /** Exactly what is sent. */
  sample: string;
  request: ReadingRequest;
  /** A worst case, in US dollars. */
  cost: number;
}

/** Everything that would be sent to suggest an overall comment, with a worst-case estimate; sends nothing. */
export async function planOverallSuggestion(ws: Workspace, proxy: ReadingProxy, options: { model?: string; capUsd?: number } = {}): Promise<OverallPlan> {
  const model = options.model ?? DEFAULT_MODEL;
  const capUsd = options.capUsd ?? DEFAULT_CAP_USD;
  const { prices, provider } = await proxy.health();
  try {
    priceOf(prices, model);
  } catch (err) {
    if (err instanceof ReadingError) throw new DraftingError(err.message);
    throw err;
  }
  const { text } = await currentSample(ws);
  const request = buildOverallRequest(text, model);
  const [, , worst] = estimate(prices, request);
  return { model, capUsd, provider, sample: text, request, cost: worst };
}

export interface OverallSuggestion {
  comment: string;
  call: ModelCall;
  spentUsd: number;
  warnings: string[];
}

/** The AI's output must be a comment; anything else is unparsed, never trusted. */
export function parseOverallResponse(data: unknown): ProxyResponse {
  const response = data as ProxyResponse;
  if (response.outcome !== "complete") return { ...response, parsed: null };
  const parsed = OverallOut.safeParse(response.parsed);
  return parsed.success ? { ...response, parsed: parsed.data } : { ...response, outcome: "unparsed", parsed: null };
}

/** Send a confirmed plan: rebuilt and checked against what was confirmed; the suggestion is returned for the moderator, and not recorded as anything. */
export async function runOverallSuggestion(ws: Workspace, plan: OverallPlan, options: { proxy: ReadingProxy; now?: () => Date }): Promise<OverallSuggestion | null> {
  const now = options.now ?? (() => new Date());
  const { text } = await currentSample(ws);
  const request = buildOverallRequest(text, plan.model);
  if (JSON.stringify(request) !== JSON.stringify(plan.request)) {
    throw new DraftingError("a verdict, a mark or the sample changed after you confirmed what would be sent; nothing was sent, so ask again");
  }
  const inputs: CallInputs = { provider: plan.provider ?? "unknown", prompt_version: OVERALL_PROMPT_VERSION, rubric_version: "none", approval_id: "none", approved_text_sha256: sha256Text(text), brief_approval_id: null, brief_sha256: null };
  let response: ProxyResponse;
  try {
    const runId = (await options.proxy.openRun(plan.capUsd, plan.cost)).id;
    response = parseOverallResponse(await options.proxy.read(runId, request));
  } catch (err) {
    if (err instanceof ProviderError) {
      if (err.requestSha256) await recordSuggestionCall(ws, "overall", failedCall(inputs, plan.model, null, err, now(), "live"), null, "provider_error", now());
      throw new DraftingError(err.message);
    }
    if (err instanceof ProxyRefusal || err instanceof WorkspaceError) throw new DraftingError(err.message);
    throw err;
  }
  const when = now();
  const call = callRecord(response, inputs, plan.model, null, when);
  await recordSuggestionCall(ws, "overall", call, response, response.outcome, when);
  const out = response.outcome === "complete" ? (response.parsed as z.output<typeof OverallOut>) : null;
  const comment = out?.comment.trim() ?? "";
  if (!comment) return null;
  const warnings: string[] = [];
  if (!/[.!?)'’]$/.test(comment)) warnings.push("the suggested comment seems to end mid-sentence; check it");
  return { comment, call, spentUsd: pyRound(response.cost_usd, 6), warnings };
}
