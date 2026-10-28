/**
 * Suggesting a verdict and a comment for it (ADR 0011): when the moderator has finished reviewing a submission and asks, the AI suggests one
 * of the four verdicts and a comment explaining it, from the moderator's own judgements, the original marker's marks and the AI's reading.
 *
 * What is sent, for one submission, only when asked: the instructions (`verdict-comment-v1`), the rubric, and one block of the moderation of
 * that submission: the original marker's overall mark (and criterion levels and marks, where they gave them), the moderator's level, mark and
 * comment for each criterion and the overall mark those imply, the AI reading's suggested level and rationale for each criterion, and the
 * verdict the moderator has chosen, if any. Never the submission, the brief, the marker's comments or the AI's quoted evidence. The moderator
 * sees exactly what will be sent before confirming; the request is rebuilt just before it is sent, and must equal the one confirmed.
 *
 * The suggestion is shown to the moderator and kept as a record of the call; it never becomes the verdict or the comment on its own.
 */

import * as z from "zod";
import { foundOn, redactionsIn, type RedactionSource } from "./redactions.ts";
import { IdentifiersFound, identifiersInRequest } from "./identifiers.ts";
import { UnapprovedText, approvedText } from "./boundary.ts";
import { DraftingError, failedCall } from "./drafting.ts";
import { readingProblems, staleJudgements } from "./evidence.ts";
import { loadJudgements } from "./judgement.ts";
import { loadRubric } from "./marking.ts";
import { criterionMax, entryMark, impliedOverall } from "./marks.ts";
import { Verdict, type AISuggestion, type ModelCall, type OriginalAssessment, type Rubric } from "./models.ts";
import { PROMPTS } from "./prompts.ts";
import { pyFormatG, pyRound } from "./pytext.ts";
import { callRecord, type CallInputs, DEFAULT_CAP_USD, DEFAULT_MODEL, estimate, freePath, loadReadings, priceOf, type ProxyResponse, ReadingError, type ReadingProxy, type ReadingRequest, renderRubric, stampOf } from "./reading.ts";
import { loadRequest } from "./request.ts";
import { markingWithheld } from "./reviewState.ts";
import { sha256Text } from "./text.ts";
import { currentMarking, VERDICTS } from "./verdict.ts";
import { ProviderError, ProxyRefusal, type Workspace, WorkspaceError } from "./workspace.ts";

export const VERDICT_PROMPT_VERSION = "verdict-comment-v1";
const MAX_VERDICT_TOKENS = 1500;

/** What the AI returns: a verdict and the comment that explains it. */
export const VerdictOut = z.strictObject({ verdict: Verdict, comment: z.string() });
export type VerdictOut = z.output<typeof VerdictOut>;
const VERDICT_SCHEMA = {
  type: "object",
  properties: { verdict: { type: "string", enum: ["agree", "generous", "harsh", "inconsistent"] }, comment: { type: "string" } },
  required: ["verdict", "comment"],
  additionalProperties: false,
};

const mark = (n: number | null, max: number | null) => (n === null ? "none" : `${pyFormatG(n)}${max !== null ? ` out of ${pyFormatG(max)}` : ""}`);

interface Basis {
  rubric: Rubric;
  approvalId: string;
  approvedSha256: string;
  text: string;
  implied: number;
}

/** The moderation of one submission as it is sent: only judgements, marks and the AI reading's levels and rationales. */
export function renderModeration(options: {
  rubric: Rubric;
  markings: OriginalAssessment[];
  judgements: Map<string, { level_id: string; mark: number | null; comment: string | null }>;
  readings: Map<string, AISuggestion>;
  implied: number;
  verdict: Verdict | null;
}): string {
  const { rubric, markings, judgements, readings, implied, verdict } = options;
  const level = (c: (typeof rubric.criteria)[number], id: string | null) => (id === null ? "none" : `${c.levels.find((l) => l.id === id)?.label ?? id} (level id ${id})`);
  const lines: string[] = [];
  for (const m of markings) {
    const who = markings.length > 1 ? `The original marker (${m.marker_label})'s` : "The original marker's";
    lines.push(`${who} overall mark: ${m.overall_mark === null ? "none given" : `${pyFormatG(m.overall_mark)} out of 100`}`);
  }
  lines.push(`The moderator's overall mark, implied by their criterion marks: ${pyFormatG(implied)} out of 100`);
  lines.push(`The verdict the moderator has chosen: ${verdict ?? "none yet"}`);
  for (const c of rubric.criteria) {
    const j = judgements.get(c.id)!;
    const max = criterionMax(c);
    lines.push("", `Criterion: ${c.title} (id ${c.id})`);
    for (const m of markings) {
      const o = m.criterion_marks.find((x) => x.criterion_id === c.id);
      if (o) lines.push(`${markings.length > 1 ? `The original marker (${m.marker_label})'s` : "The original marker's"} level: ${level(c, o.level_id)}; mark: ${mark(o.mark, max)}`);
    }
    lines.push(`The moderator's level: ${level(c, j.level_id)}; mark: ${mark(entryMark(c, j), max)}`);
    lines.push(`The moderator's comment: ${j.comment?.trim() ? j.comment.trim() : "(none)"}`);
    const r = readings.get(c.id);
    if (r) lines.push(`The AI reading's suggested level: ${level(c, r.suggested_level_id)}`, `The AI reading's rationale: ${r.rationale.trim() || "(none)"}`);
    else lines.push("The AI reading: none for this criterion");
  }
  return lines.join("\n");
}

/** What would be sent now, refused (with why, saying what to do) unless the review is complete enough to suggest from. */
async function currentBasis(ws: Workspace, submissionId: string, verdict: Verdict | null): Promise<Basis> {
  if (ws.manifest.workspace_type === "marking") throw new DraftingError("only a moderation has a verdict to suggest");
  const request = await loadRequest(ws);
  if (!request.sample.some((s) => s.submission_id === submissionId)) throw new DraftingError(`${submissionId} is not in the sample`);
  const withheld = await markingWithheld(ws, submissionId);
  if (withheld) throw new DraftingError(`the original marking and the AI reading aren't shown yet, so they can't be used: ${withheld}`);
  let approval;
  try {
    approval = (await approvedText(ws, submissionId))[1];
  } catch (err) {
    if (err instanceof UnapprovedText) throw new DraftingError(err.message);
    throw err;
  }
  const rubric = await loadRubric(ws);
  const markings = (await currentMarking(ws, submissionId)).filter((m) => m.overall_mark !== null || m.criterion_marks.length > 0);
  if (!markings.length) throw new DraftingError("there is no original marking to compare with; import or enter it first");
  if (markings.every((m) => m.overall_mark === null)) throw new DraftingError("the original marking has no overall mark to compare with");
  let readings: AISuggestion[];
  try {
    readings = await loadReadings(ws, submissionId);
  } catch (err) {
    if (err instanceof WorkspaceError) throw new DraftingError(`there is no AI reading of this submission to use; run the AI reading first (${err.message})`);
    throw err;
  }
  // Against the figures approved now too: excluding a figure and approving the same text again keeps the approval, but not a reading that relied on the figure.
  const problems = readingProblems(submissionId, readings, approval.approved_text_sha256, { approvalId: approval.id, rubric, approvedFigures: approval.figures });
  if (problems.length) throw new DraftingError(`the AI reading isn't current, so it can't be used: ${problems[0]}`);
  const judged = await loadJudgements(ws, submissionId);
  if (staleJudgements(judged, approval.approved_text_sha256, rubric).length) throw new DraftingError("a judgement of yours was recorded against an earlier text or rubric; record it again first");
  const judgements = new Map(judged.map((j) => [j.criterion_id, { ...(j.revised ?? j.first) }]));
  const missing = rubric.criteria.filter((c) => !judgements.has(c.id)).map((c) => c.title);
  if (missing.length) throw new DraftingError(`judge every criterion first: the suggestion is made from your marks (still to judge: ${missing.join(", ")})`);
  const implied = impliedOverall(rubric.criteria, (c) => entryMark(c, judgements.get(c.id)!));
  if ("missing" in implied) throw new DraftingError(`your criterion marks don't imply an overall mark yet (${implied.missing}), so there is nothing to compare the original mark with`);
  const text = renderModeration({ rubric, markings, judgements, readings: new Map(readings.map((r) => [r.criterion_id, r])), implied: implied.mark, verdict });
  // Comments and rationales were anonymised when they were made, and a key or rule added since may redact more: nothing is sent until they are anonymised again.
  const sources: RedactionSource[] = rubric.criteria.flatMap((c): RedactionSource[] => [
    [`your comment on ${c.title}`, "comment", judgements.get(c.id)?.comment],
    [`the AI reading's reasoning on ${c.title}`, "reading", readings.find((r) => r.criterion_id === c.id)?.rationale],
  ]);
  const matches = await redactionsIn(ws, sources);
  // What is sent is every part together, so a match that only shows across them (none is expected) is found in the whole as well.
  const found = matches.length ? matches : await redactionsIn(ws, [["the moderation, as it would be sent", "comment", text]]);
  if (found.length) {
    throw foundOn(new DraftingError("a comment of yours or the AI reading's reasoning contains something the anonymisation rules or pseudonym key now redact; record your judgement again, or run the AI reading again (nothing is sent until then)"), found);
  }
  return { rubric, approvalId: approval.id, approvedSha256: approval.approved_text_sha256, text, implied: implied.mark };
}

export function buildVerdictRequest(rubric: Rubric, moderation: string, model: string): ReadingRequest {
  return {
    model,
    max_output_tokens: MAX_VERDICT_TOKENS,
    prompt: { version: VERDICT_PROMPT_VERSION, instructions: PROMPTS[VERDICT_PROMPT_VERSION] },
    blocks: [
      { kind: "rubric", heading: "RUBRIC", text: renderRubric(rubric), approved_sha256: null },
      // Approved as exactly this text: the moderator is shown it before confirming.
      { kind: "marking", heading: "THE MODERATION OF THIS SUBMISSION", text: moderation, approved_sha256: sha256Text(moderation) },
    ],
    output_schema: VERDICT_SCHEMA,
  };
}

export interface VerdictPlan {
  submissionId: string;
  model: string;
  capUsd: number;
  provider: string | null;
  /** Exactly what is sent of the moderation. */
  moderation: string;
  request: ReadingRequest;
  /** A worst case, in US dollars. */
  cost: number;
}

/** Everything that would be sent to suggest a verdict and comment for one submission, with a worst-case estimate; sends nothing. */
export async function planVerdictSuggestion(
  ws: Workspace,
  proxy: ReadingProxy,
  submissionId: string,
  options: { verdict?: Verdict | null; model?: string; capUsd?: number } = {},
): Promise<VerdictPlan> {
  const model = options.model ?? DEFAULT_MODEL;
  const capUsd = options.capUsd ?? DEFAULT_CAP_USD;
  const { prices, provider } = await proxy.health();
  try {
    priceOf(prices, model);
  } catch (err) {
    if (err instanceof ReadingError) throw new DraftingError(err.message);
    throw err;
  }
  const basis = await currentBasis(ws, submissionId, options.verdict ?? null);
  const request = buildVerdictRequest(basis.rubric, basis.text, model);
  const found = identifiersInRequest(request);
  if (found.length) throw new IdentifiersFound(found); // listed on the screen, never sent
  const [, , worst] = estimate(prices, request);
  return { submissionId, model, capUsd, provider, moderation: basis.text, request, cost: worst };
}

export interface VerdictSuggestion {
  verdict: Verdict;
  comment: string;
  /** The model call it came from, and what it cost. */
  call: ModelCall;
  spentUsd: number;
  warnings: string[];
}

/** The AI's output must be a verdict and a comment; anything else is unparsed, never trusted. */
export function parseVerdictResponse(data: unknown): ProxyResponse {
  const response = data as ProxyResponse;
  if (response.outcome !== "complete") return { ...response, parsed: null };
  const parsed = VerdictOut.safeParse(response.parsed);
  return parsed.success ? { ...response, parsed: parsed.data } : { ...response, outcome: "unparsed", parsed: null };
}

export async function recordSuggestionCall(ws: Workspace, id: string, call: ModelCall, response: ProxyResponse | null, outcome: string, when: Date): Promise<void> {
  const record = await freePath(ws, `${VERDICTS}/calls/${id}--${stampOf(when)}--${call.model_requested}`);
  try {
    await ws.writeJson(record, { outcome, call }, { private: true });
    if (response) await ws.writeJson(record.replace(`${VERDICTS}/calls/`, `${VERDICTS}/raw/`), JSON.parse(response.raw_json), { private: true });
  } finally {
    await ws.secure().catch(() => {});
  }
}

/** Send a confirmed plan: rebuilt and checked against what was confirmed; the suggestion is returned for the moderator, and not recorded as anything. */
export async function runVerdictSuggestion(ws: Workspace, plan: VerdictPlan, options: { proxy: ReadingProxy; verdict?: Verdict | null; now?: () => Date }): Promise<VerdictSuggestion | null> {
  const now = options.now ?? (() => new Date());
  const id = plan.submissionId;
  const basis = await currentBasis(ws, id, options.verdict ?? null);
  const request = buildVerdictRequest(basis.rubric, basis.text, plan.model);
  if (JSON.stringify(request) !== JSON.stringify(plan.request)) {
    throw new DraftingError("your judgements, the original marking, the AI reading or the verdict you chose changed after you confirmed what would be sent; nothing was sent, so ask again");
  }
  const inputs: CallInputs = { provider: plan.provider ?? "unknown", prompt_version: VERDICT_PROMPT_VERSION, rubric_version: basis.rubric.version, approval_id: basis.approvalId, approved_text_sha256: basis.approvedSha256, brief_approval_id: null, brief_sha256: null };
  let response: ProxyResponse;
  try {
    const runId = (await options.proxy.openRun(plan.capUsd, plan.cost)).id;
    response = parseVerdictResponse(await options.proxy.read(runId, request));
  } catch (err) {
    if (err instanceof ProviderError) {
      if (err.requestSha256) await recordSuggestionCall(ws, id, failedCall(inputs, plan.model, null, err, now(), "live"), null, "provider_error", now());
      throw new DraftingError(err.message);
    }
    if (err instanceof ProxyRefusal || err instanceof WorkspaceError) throw new DraftingError(err.message);
    throw err;
  }
  const when = now();
  const call = callRecord(response, inputs, plan.model, null, when);
  await recordSuggestionCall(ws, id, call, response, response.outcome, when);
  const spentUsd = pyRound(response.cost_usd, 6);
  const out = response.outcome === "complete" ? (response.parsed as VerdictOut) : null;
  const comment = out?.comment.trim() ?? "";
  if (!out || !comment) return null;
  const warnings: string[] = [];
  if (!/[.!?)'’]$/.test(comment)) warnings.push("the suggested comment seems to end mid-sentence; check it");
  return { verdict: out.verdict, comment, call, spentUsd, warnings };
}
