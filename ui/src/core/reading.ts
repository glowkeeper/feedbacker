/**
 * The AI reading: an evidence-cited second reading per criterion. A port of
 * `core/src/feedbacker_core/reading.py` (#18, ADR 0003) to the browser core,
 * reaching the model only through the local proxy (#53, ADR 0004).
 *
 * Maintainer decisions (2026-09-25, recorded on #18):
 *
 * - default model Claude Sonnet 5, configurable per run;
 * - a per-run spend limit of $5, with a worst-case estimate the moderator
 *   confirms (the estimate may be above the limit: the run then stops at the
 *   limit, decided 2026-09-27);
 * - if the model declines on safety grounds, the same approved request is
 *   sent once to a fallback model (Claude Opus 5), and both calls are recorded;
 * - the brief is part of every request unless the moderator explicitly opts out.
 *
 * Only approved anonymised text is sent. Each request is rebuilt from the
 * current approved material immediately before sending, and it must equal the
 * request the moderator confirmed; otherwise nothing is sent for that
 * submission. The model never sees the original marker's marks or comments.
 * Every call, including refused and failed ones, leaves a call record and its
 * raw response.
 *
 * Nothing here knows the provider or holds a key: the proxy holds the key,
 * knows the provider and its prices, checks every request against the model
 * data boundary, and enforces the spend limit (proxy/README.md).
 */

import * as z from "zod";
import { approvedBriefText, approvedText, requireApproved, requireApprovedBrief, UnapprovedText } from "./boundary.ts";
import { BRIEF } from "./brief.ts";
import { loadRubric } from "./marking.ts";
import { AISuggestion, type Approval, EvidenceQuote, ModelCall, type Rubric, TokenUsage } from "./models.ts";
import { PROMPTS } from "./prompts.ts";
import { pyFormatG, pyRound, pyStrip } from "./pytext.ts";
import { loadRequest } from "./request.ts";
import { sha256Text } from "./text.ts";
import { type ProxyHealth, ProviderError, ProxyRefusal, type Workspace, WorkspaceError } from "./workspace.ts";

export const PROMPT_VERSION = "reading-v1";
export const DEFAULT_MODEL = "claude-sonnet-5";
export const FALLBACK_MODEL = "claude-opus-5";
export const DEFAULT_CAP_USD = 5.0;
export const MAX_OUTPUT_TOKENS = 16000; // also the output bound used in every estimate
const CHARS_PER_TOKEN = 3; // conservative: overestimates input tokens
export const READINGS = "readings";

/** A reading run cannot start or must stop. Messages never contain the API key (the proxy holds it). */
export class ReadingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadingError";
  }
}

// --- Structured output ---------------------------------------------------------------------

export const CriterionReadingOut = z.strictObject({
  criterion_id: z.string(),
  suggested_level_id: z.string().nullable(),
  rationale: z.string(),
  evidence: z.array(z.string()),
  draft_comment: z.string(),
  missing_evidence: z.boolean(),
});
export const ReadingOut = z.strictObject({ criteria: z.array(CriterionReadingOut) });
export type ReadingOut = z.output<typeof ReadingOut>;

/** The JSON Schema the model must follow (without "$schema", whose URL the proxy would take for a leak). */
export const OUTPUT_SCHEMA: Record<string, unknown> = (() => {
  const { $schema: _, ...schema } = z.toJSONSchema(ReadingOut) as Record<string, unknown>;
  return schema;
})();

// --- The proxy, as the reading sees it ----------------------------------------------------------

export interface ReadingBlock {
  kind: "rubric" | "brief" | "submission";
  heading: string;
  text: string;
  approved_sha256: string | null;
}

/** Exactly what the proxy is asked to send: the model data boundary (proxy/README.md). */
export interface ReadingRequest {
  model: string;
  max_output_tokens: number;
  prompt: { version: string; instructions: string };
  blocks: ReadingBlock[];
  output_schema: Record<string, unknown>;
}

export type Outcome = "complete" | "refused" | "truncated" | "unparsed";

interface ProxyResponse {
  outcome: Outcome;
  parsed: unknown;
  model_reported: string | null;
  request_id: string | null;
  stop_reason: string | null;
  usage: unknown;
  raw_json: string;
  provider: string;
  request_sha256: string;
  cost_usd: number;
}

/** The proxy's reading API (HttpProxyClient implements it). */
export interface ReadingProxy {
  health(): Promise<ProxyHealth>;
  openRun(limitUsd: number, estimateUsd: number): Promise<{ id: string }>;
  read(runId: string, request: ReadingRequest): Promise<unknown>;
}

// --- Requests --------------------------------------------------------------------------------------

/** A stable, readable rendering of the source rubric (identical for every call). */
export function renderRubric(rubric: Rubric): string {
  const lines = [`Rubric: ${rubric.title} (version ${rubric.version})`];
  for (const c of rubric.criteria) {
    const weight = c.weight ? `, weight ${pyFormatG(c.weight)}%` : "";
    lines.push(`\nCriterion id: ${c.id}\nTitle: ${c.title}${weight}`);
    if (c.description) lines.push(`Description: ${c.description}`);
    for (const lv of c.levels) {
      const points = lv.points !== null ? `, ${pyFormatG(lv.points)} points` : "";
      lines.push(`- Level id: ${lv.id} | ${lv.label}${points}: ${lv.descriptor}`);
    }
  }
  return lines.join("\n");
}

interface ApprovedText {
  text: string;
  sha256: string;
}

/** Stable content first (instructions, rubric, brief), so it can be cached. */
export function buildRequest(rubric: Rubric, brief: ApprovedText | null, pseudonym: string, submission: ApprovedText, model: string): ReadingRequest {
  return {
    model,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    prompt: { version: PROMPT_VERSION, instructions: PROMPTS[PROMPT_VERSION] },
    blocks: [
      { kind: "rubric", heading: "RUBRIC", text: renderRubric(rubric), approved_sha256: null },
      { kind: "brief", heading: "ASSESSMENT BRIEF", text: brief ? brief.text : "(No brief was provided.)", approved_sha256: brief ? brief.sha256 : null },
      { kind: "submission", heading: `SUBMISSION ${pseudonym}`, text: submission.text, approved_sha256: submission.sha256 },
    ],
    output_schema: OUTPUT_SCHEMA,
  };
}

const withModel = (request: ReadingRequest, model: string): ReadingRequest => ({ ...request, model });
const codePoints = (s: string) => [...s].length;

/**
 * Worst case for one call, as the proxy reserves it: input overestimated at
 * 3 characters a token (the instructions, each block as sent, and the output
 * schema, which is billed as input too), and output at its maximum.
 */
export function estimate(prices: ProxyHealth["prices"], request: ReadingRequest): [number, number, number] {
  const chars =
    codePoints(request.prompt.instructions) +
    request.blocks.reduce((n, b) => n + codePoints(`${b.heading}\n\n${b.text}`), 0) +
    codePoints(JSON.stringify(request.output_schema));
  const tokensIn = Math.ceil(chars / CHARS_PER_TOKEN);
  const tokensOut = request.max_output_tokens;
  const p = prices[request.model];
  return [tokensIn, tokensOut, (tokensIn * p.input + tokensOut * p.output) / 1_000_000];
}

// --- Planning ----------------------------------------------------------------------------------------

export interface PlannedReading {
  submissionId: string;
  pseudonym: string;
  request: ReadingRequest;
  tokensIn: number;
  tokensOut: number;
  cost: number; // primary call, worst case
  fallbackCost: number; // fallback call, worst case (0 when the fallback is off)
}

export interface Plan {
  provider: string | null; // the proxy's provider, as it reports it
  model: string;
  capUsd: number;
  fallbackModel: string | null;
  withBrief: boolean;
  readings: PlannedReading[];
  skipped: Map<string, string>;
}

/** At most: every call at its worst case, including a fallback for each. */
export const estimatedCost = (plan: Plan) => plan.readings.reduce((n, r) => n + r.cost + r.fallbackCost, 0);

export const readingPath = (submissionId: string) => `${READINGS}/${submissionId}.json`;

interface Material {
  rubric: Rubric;
  brief: ApprovedText | null;
  briefApproval: Approval | null;
}

async function currentMaterial(ws: Workspace, withBrief: boolean): Promise<Material> {
  const rubric = await loadRubric(ws);
  if (!withBrief) return { rubric, brief: null, briefApproval: null };
  if (!(await ws.exists(BRIEF))) {
    throw new ReadingError("no brief has been imported; import and approve it ('brief import'), or run with --no-brief to read without one");
  }
  try {
    const [text, approval] = await approvedBriefText(ws);
    return { rubric, brief: { text, sha256: approval.approved_text_sha256 }, briefApproval: approval };
  } catch (err) {
    if (err instanceof UnapprovedText) throw new ReadingError(`${err.message}; approve it ('anonymise approve WORKSPACE brief') before reading`);
    throw err;
  }
}

function priceOf(prices: ProxyHealth["prices"], model: string) {
  if (!Object.hasOwn(prices, model)) {
    throw new ReadingError(`no price is known for model '${model}', so the spend limit cannot be enforced; known models: ${Object.keys(prices).join(", ")}`);
  }
  return prices[model];
}

export interface PlanOptions {
  model?: string;
  capUsd?: number;
  fallback?: boolean;
  withBrief?: boolean;
  replace?: boolean;
}

/** Everything that would be sent, with a worst-case estimate. Sends nothing. */
export async function planReadings(ws: Workspace, proxy: ReadingProxy, submissionIds: string[] | null = null, options: PlanOptions = {}): Promise<Plan> {
  const model = options.model ?? DEFAULT_MODEL;
  const capUsd = options.capUsd ?? DEFAULT_CAP_USD;
  const fallback = options.fallback ?? true;
  const withBrief = options.withBrief ?? true;
  if (!(capUsd > 0)) throw new ReadingError("the spend limit must be greater than 0");
  const { prices, provider } = await proxy.health();
  priceOf(prices, model);
  if (fallback) priceOf(prices, FALLBACK_MODEL);
  const { rubric, brief } = await currentMaterial(ws, withBrief);
  const sample = (await loadRequest(ws)).sample;
  const known = new Map(sample.map((s) => [s.submission_id, s]));
  const plan: Plan = { provider, model, capUsd, fallbackModel: fallback ? FALLBACK_MODEL : null, withBrief, readings: [], skipped: new Map() };
  for (const id of submissionIds?.length ? submissionIds : sample.map((s) => s.submission_id)) {
    const s = known.get(id);
    if (!s) {
      plan.skipped.set(id, "not in the sample");
      continue;
    }
    if ((await ws.exists(readingPath(id))) && !options.replace) {
      plan.skipped.set(id, "already read; use replace to read again");
      continue;
    }
    let submission: ApprovedText;
    try {
      const [text, approval] = await approvedText(ws, id);
      submission = { text, sha256: approval.approved_text_sha256 };
    } catch (err) {
      if (err instanceof UnapprovedText || err instanceof WorkspaceError) {
        plan.skipped.set(id, err.message);
        continue;
      }
      throw err;
    }
    const request = buildRequest(rubric, brief, s.pseudonym, submission, model);
    const [tokensIn, tokensOut, cost] = estimate(prices, request);
    const fallbackCost = fallback ? estimate(prices, withModel(request, FALLBACK_MODEL))[2] : 0;
    plan.readings.push({ submissionId: id, pseudonym: s.pseudonym, request, tokensIn, tokensOut, cost, fallbackCost });
  }
  return plan;
}

// --- Running -----------------------------------------------------------------------------------------

export interface RunResult {
  read: Map<string, AISuggestion[]>;
  failed: Map<string, string>;
  notRun: Map<string, string>;
  warnings: Map<string, string[]>;
  fallbacks: string[];
  spentUsd: number;
}

interface Current {
  provider: string;
  request: ReadingRequest;
  text: string;
  approval: Approval;
  briefApproval: Approval | null;
  rubric: Rubric;
}

/**
 * Rebuild the request from the current approved material, pass the gate, and
 * require it to equal what the moderator confirmed. Throws otherwise, before
 * anything is sent.
 */
async function rebuild(ws: Workspace, planned: PlannedReading, plan: Plan, model: string): Promise<Current> {
  const { rubric, brief, briefApproval } = await currentMaterial(ws, plan.withBrief);
  const [text, approval] = await approvedText(ws, planned.submissionId);
  await requireApproved(ws, planned.submissionId, text);
  if (brief) await requireApprovedBrief(ws, brief.text);
  const request = buildRequest(rubric, brief, planned.pseudonym, { text, sha256: approval.approved_text_sha256 }, model);
  if (JSON.stringify(request) !== JSON.stringify(withModel(planned.request, model))) {
    throw new UnapprovedText("the submission, brief, or rubric changed after you confirmed the estimate; nothing was sent, so run the reading again");
  }
  return { provider: plan.provider ?? "unknown", request, text, approval, briefApproval, rubric };
}

/** Python's strftime("%Y%m%dT%H%M%S%f") in UTC (a Date has milliseconds, so the last three digits are 0). */
const stampOf = (when: Date) => when.toISOString().replace(/[-:]/g, "").replace(/\.(\d{3})Z$/, "$1000");

/** Python's datetime.isoformat() of a UTC time: microseconds only when not zero, and "+00:00". */
function isoformat(when: Date): string {
  const [base, ms] = when.toISOString().replace("Z", "").split(".");
  return `${base}${ms === "000" ? "" : `.${ms}000`}+00:00`;
}

/** A path under `readings/`, with a suffix if the name is already taken (two writes in one millisecond). */
async function freePath(ws: Workspace, base: string): Promise<string> {
  let path = `${base}.json`;
  for (let n = 2; await ws.exists(path); n++) path = `${base}-${n}.json`;
  return path;
}

/** The proxy refused a request for the spend limit: nothing more can be sent in this run. */
class SpendLimitReached extends Error {}

export async function runReadings(ws: Workspace, plan: Plan, options: { proxy: ReadingProxy; now?: () => Date }): Promise<RunResult> {
  const now = options.now ?? (() => new Date());
  const result: RunResult = { read: new Map(), failed: new Map(), notRun: new Map(), warnings: new Map(), fallbacks: [], spentUsd: 0 };
  const log: Record<string, unknown>[] = [];
  const started = now();
  try {
    let runId: string;
    try {
      runId = (await options.proxy.openRun(plan.capUsd, estimatedCost(plan))).id;
    } catch (err) {
      if (err instanceof ProxyRefusal || err instanceof WorkspaceError) throw new ReadingError(err.message);
      throw err;
    }
    for (const [i, planned] of plan.readings.entries()) {
      if (planned.cost > plan.capUsd - result.spentUsd) {
        for (const later of plan.readings.slice(i)) {
          result.notRun.set(later.submissionId, `the $${pyFormatG(plan.capUsd)} spend limit would be exceeded ($${result.spentUsd.toFixed(2)} spent)`);
        }
        break;
      }
      try {
        await readOne(ws, planned, plan, options.proxy, runId, result, log, now);
      } catch (err) {
        if (!(err instanceof SpendLimitReached)) throw err;
        // As when the limit is reached here: this submission and the rest are not run.
        for (const later of plan.readings.slice(i)) result.notRun.set(later.submissionId, err.message);
        break;
      }
    }
  } finally {
    await writeLog(ws, started, plan, result, log);
  }
  return result;
}

function parseResponse(data: unknown): ProxyResponse {
  const response = data as ProxyResponse;
  if (response.outcome === "complete") {
    // The model's output must be the reading's shape; anything else is unparsed, never trusted.
    const parsed = ReadingOut.safeParse(response.parsed);
    return parsed.success ? { ...response, parsed: parsed.data } : { ...response, outcome: "unparsed", parsed: null };
  }
  return { ...response, parsed: null };
}

async function readOne(ws: Workspace, planned: PlannedReading, plan: Plan, proxy: ReadingProxy, runId: string, result: RunResult, log: Record<string, unknown>[], now: () => Date): Promise<void> {
  const id = planned.submissionId;
  let model = plan.model;
  let fallbackFrom: string | null = null;
  let current: Current;
  let response: ProxyResponse;
  let call: ModelCall;
  while (true) {
    try {
      current = await rebuild(ws, planned, plan, model);
      response = parseResponse(await proxy.read(runId, current.request));
    } catch (err) {
      if (err instanceof UnapprovedText || err instanceof WorkspaceError || err instanceof ReadingError) {
        result.failed.set(id, err.message);
        return;
      }
      if (err instanceof ProviderError) {
        // The request was forwarded, so the failed call is recorded too.
        if (err.requestSha256) await recordFailedCall(ws, id, current!, model, fallbackFrom, err, log, now());
        if (err.fatal) throw new ReadingError(err.message);
        result.failed.set(id, err.message);
        return;
      }
      if (err instanceof ProxyRefusal) {
        // No key, or no run: nothing more can be sent. The spend limit: nothing
        // more fits in this run. Otherwise the proxy refused this request (e.g.
        // a possible identifier), and nothing was sent.
        if (err.type === "key" || err.type === "run") throw new ReadingError(err.message);
        if (err.type === "spend") throw new SpendLimitReached(err.message);
        result.failed.set(id, err.message);
        return;
      }
      throw err;
    }
    result.spentUsd += response.cost_usd;
    call = callRecord(response, current, model, fallbackFrom, now());
    await recordCall(ws, id, call, response, now());
    log.push({
      submission_id: id,
      model,
      outcome: response.outcome,
      request_id: response.request_id,
      usage: call.usage,
      cost_usd: pyRound(response.cost_usd, 6),
    });
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
    break;
  }
  if (response.outcome === "refused") {
    result.failed.set(id, `${model} declined to read this submission`);
    return;
  }
  if (response.outcome !== "complete") {
    result.failed.set(id, `the reading was incomplete (${response.outcome}, stop reason: ${response.stop_reason})`);
    return;
  }
  const [suggestions, warnings] = toSuggestions(response.parsed as ReadingOut, current, call, planned, now());
  await store(ws, id, suggestions, now());
  result.read.set(id, suggestions);
  if (warnings.length) result.warnings.set(id, warnings);
}

/**
 * A call the proxy forwarded but the provider failed (a server error, a
 * rejected key): a call record with the error and no response, and a line in
 * the run log, so every forwarded request stays traceable. There is no raw
 * response to keep.
 */
async function recordFailedCall(ws: Workspace, id: string, current: Current, model: string, fallbackFrom: string | null, err: ProviderError, log: Record<string, unknown>[], when: Date): Promise<void> {
  const call = ModelCall.parse({
    provider: current.provider,
    model_requested: model,
    model_reported: null,
    request_id: null,
    prompt_version: PROMPT_VERSION,
    rubric_version: current.rubric.version,
    approval_id: current.approval.id,
    approved_text_sha256: current.approval.approved_text_sha256,
    brief_approval_id: current.briefApproval?.id ?? null,
    brief_sha256: current.briefApproval?.approved_text_sha256 ?? null,
    fallback_from: fallbackFrom,
    request_sha256: err.requestSha256,
    response_sha256: null,
    stop_reason: null,
    usage: TokenUsage.parse({}),
    produced_by: "live",
    timestamp: when.toISOString(),
    error: err.message,
  });
  const record = await freePath(ws, `${READINGS}/calls/${id}--${stampOf(when)}--${model}`);
  await ws.writeJson(record, { outcome: "provider_error", call }, { private: true });
  log.push({ submission_id: id, model, outcome: "provider_error", request_id: null, usage: call.usage, cost_usd: 0 });
}

function callRecord(response: ProxyResponse, current: Current, model: string, fallbackFrom: string | null, when: Date): ModelCall {
  return ModelCall.parse({
    provider: response.provider,
    model_requested: model,
    model_reported: response.model_reported,
    request_id: response.request_id,
    prompt_version: PROMPT_VERSION,
    rubric_version: current.rubric.version,
    approval_id: current.approval.id,
    approved_text_sha256: current.approval.approved_text_sha256,
    brief_approval_id: current.briefApproval?.id ?? null,
    brief_sha256: current.briefApproval?.approved_text_sha256 ?? null,
    fallback_from: fallbackFrom,
    request_sha256: response.request_sha256, // the proxy's hash of exactly what it sent
    response_sha256: sha256Text(response.raw_json),
    stop_reason: response.stop_reason,
    usage: TokenUsage.parse(response.usage),
    produced_by: "live",
    timestamp: when.toISOString(),
    error: response.outcome === "complete" ? null : response.outcome,
  });
}

/** Every call, whatever its outcome, leaves its record and raw response. */
async function recordCall(ws: Workspace, id: string, call: ModelCall, response: ProxyResponse, when: Date): Promise<void> {
  const stamp = `${stampOf(when)}--${call.model_requested}`;
  const record = await freePath(ws, `${READINGS}/calls/${id}--${stamp}`);
  await ws.writeJson(record, { outcome: response.outcome, call }, { private: true });
  const raw = record.replace(`${READINGS}/calls/`, `${READINGS}/raw/`);
  await ws.writeJson(raw, JSON.parse(response.raw_json), { private: true });
}

function toSuggestions(out: ReadingOut, current: Current, call: ModelCall, planned: PlannedReading, when: Date): [AISuggestion[], string[]] {
  const rubric = current.rubric;
  const warnings: string[] = [];
  const byId = new Map(out.criteria.map((r) => [r.criterion_id, r]));
  const unknown = [...byId.keys()].filter((cid) => !rubric.criteria.some((c) => c.id === cid));
  if (unknown.length) warnings.push(`ignored readings for unknown criteria: ${unknown.join(", ")}`);
  const suggestions: AISuggestion[] = [];
  rubric.criteria.forEach((criterion, index) => {
    const r = byId.get(criterion.id);
    if (!r) {
      warnings.push(`no reading returned for criterion '${criterion.id}'`);
      return;
    }
    let level = r.suggested_level_id;
    if (level !== null && !criterion.levels.some((l) => l.id === level)) {
      warnings.push(`criterion '${criterion.id}': suggested level '${level}' is not a level of this criterion, so no level is suggested`);
      level = null;
    }
    const evidence: EvidenceQuote[] = [];
    for (const quote of r.evidence) {
      if (!pyStrip(quote)) continue;
      // Offsets count code points, as everywhere in the records.
      const at = current.text.indexOf(quote);
      const start = at >= 0 ? codePoints(current.text.slice(0, at)) : null;
      evidence.push(EvidenceQuote.parse({ text: quote, verified: at >= 0, start, end: start === null ? null : start + codePoints(quote) }));
    }
    const unverified = evidence.filter((e) => !e.verified).length;
    if (unverified) warnings.push(`criterion '${criterion.id}': ${unverified} quote(s) not found verbatim in the submission (kept, flagged as unverified)`);
    const inputs = new Set([call.approved_text_sha256, call.request_sha256, ...(call.brief_sha256 ? [call.brief_sha256] : [])]);
    suggestions.push(
      AISuggestion.parse({
        id: `ai-${planned.submissionId}-${String(index + 1).padStart(2, "0")}`,
        submission_id: planned.submissionId,
        criterion_id: criterion.id,
        suggested_level_id: level,
        rationale: r.rationale,
        evidence,
        draft_comment: r.draft_comment || null,
        missing_evidence: r.missing_evidence || level === null,
        call,
        provenance: {
          source: `model call ${call.request_id || call.request_sha256.slice(0, 16)}`,
          transformation: "generated",
          actor: { kind: "model", label: call.model_reported || call.model_requested },
          timestamp: when.toISOString(),
          input_hashes: [...inputs].sort(),
        },
      }),
    );
  });
  return [suggestions, warnings];
}

async function store(ws: Workspace, id: string, suggestions: AISuggestion[], when: Date): Promise<void> {
  const path = readingPath(id);
  if (await ws.exists(path)) await ws.writeJson(await freePath(ws, `${READINGS}/history/${id}--${stampOf(when)}`), await ws.readJson(path), { private: true });
  await ws.writeJson(path, suggestions, { private: true });
}

async function writeLog(ws: Workspace, started: Date, plan: Plan, result: RunResult, log: Record<string, unknown>[]): Promise<void> {
  await ws.writeJson(
    await freePath(ws, `${READINGS}/runs/${stampOf(started)}`),
    {
      started: isoformat(started),
      provider: plan.provider,
      model: plan.model,
      fallback_model: plan.fallbackModel,
      with_brief: plan.withBrief,
      cap_usd: plan.capUsd,
      estimated_usd: pyRound(estimatedCost(plan), 6),
      spent_usd: pyRound(result.spentUsd, 6),
      calls: log,
      read: [...result.read.keys()].sort(),
      failed: Object.fromEntries(result.failed),
      not_run: Object.fromEntries(result.notRun),
      fallbacks: result.fallbacks,
    },
    { private: true },
  );
}

export async function loadReadings(ws: Workspace, submissionId: string): Promise<AISuggestion[]> {
  const path = readingPath(submissionId);
  if (!(await ws.exists(path))) throw new WorkspaceError(`no AI reading for ${submissionId}`);
  const parsed = z.array(AISuggestion).safeParse(await ws.readJson(path)); // the workspace reports a file that isn't JSON
  if (!parsed.success) throw new WorkspaceError(`${path} is not a valid AI reading; run the reading again`);
  return parsed.data;
}
