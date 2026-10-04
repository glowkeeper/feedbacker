/**
 * The AI reading: an evidence-cited second reading per criterion. A port of
 * `core/src/feedbacker_core/reading.py` (ADR 0003) to the browser core,
 * reaching the AI only through the local proxy (ADR 0004).
 *
 * Maintainer decisions (2026-09-25):
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
 * knows the provider and its prices, checks every request against the rules
 * on what the AI may be sent, and enforces the spend limit (proxy/README.md).
 */

import * as z from "zod";
import { approvedBriefText, approvedText, requireApproved, requireApprovedBrief, requireComplete, UnapprovedText } from "./boundary.ts";
import { BRIEF } from "./brief.ts";
import { loadRubric } from "./marking.ts";
import { AISuggestion, type Approval, EvidenceQuote, ModelCall, type Rubric, TokenUsage } from "./models.ts";
import { PROMPTS } from "./prompts.ts";
import { pyFormatG, pyRound, pyStrip } from "./pytext.ts";
import { loadRequest } from "./request.ts";
import { sha256Text } from "./text.ts";
import { type ProxyHealth, ProviderError, ProxyRefusal, type Workspace, WorkspaceError } from "./workspace.ts";

export const PROMPT_VERSION = "reading-v2";
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

/** Exactly what the proxy is asked to send: the rules on what the AI may be sent (proxy/README.md). */
export interface ReadingRequest {
  model: string;
  max_output_tokens: number;
  prompt: { version: string; instructions: string };
  blocks: ReadingBlock[];
  output_schema: Record<string, unknown>;
}

export type Outcome = "complete" | "refused" | "truncated" | "unparsed";

export interface ProxyResponse {
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

/** The proxy's reading API (HttpProxyClient implements it). The batch calls are in batch.ts. */
export interface ReadingProxy {
  health(): Promise<ProxyHealth>;
  openRun(limitUsd: number, estimateUsd: number): Promise<{ id: string }>;
  read(runId: string, request: ReadingRequest): Promise<unknown>;
  /** `workspace` is the workspace's registration with the proxy, which holds one waiting batch per workspace. */
  sendBatch(runId: string, requests: ReadingRequest[], workspace: string): Promise<unknown>;
  batchStatus(batchId: string): Promise<unknown>;
  batchResults(batchId: string): Promise<unknown>;
  cancelBatch(batchId: string): Promise<unknown>;
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
/**
 * The worst case for one call: input overestimated (3 characters a token),
 * every input token billed as a cache write (the dearest way, as the proxy
 * reserves it), and output at its maximum.
 */
export function estimate(prices: ProxyHealth["prices"], request: ReadingRequest): [number, number, number] {
  const tokensIn = Math.ceil(inputChars(request) / CHARS_PER_TOKEN);
  const tokensOut = request.max_output_tokens;
  const p = prices[request.model];
  return [tokensIn, tokensOut, (tokensIn * p.input * (p.cache_write ?? 1) + tokensOut * p.output) / 1_000_000];
}

const blockChars = (b: ReadingBlock) => codePoints(`${b.heading}\n\n${b.text}`);
const inputChars = (request: ReadingRequest) =>
  codePoints(request.prompt.instructions) + request.blocks.reduce((n, b) => n + blockChars(b), 0) + codePoints(JSON.stringify(request.output_schema));

/**
 * The most a run could cost if the provider caches the shared prefix (the
 * instructions, rubric and brief, the same for every submission): the first
 * reading writes it to the cache, and each later one reads it at the cache
 * price. Still a worst case for everything else (output at its maximum, a
 * fallback for each). Only an indication: the provider caches a prefix only
 * once it is long enough, and for five minutes; in a batch, only as it can.
 * `share` is the batch's share of the price, for a batch plan.
 */
export function cachedEstimate(prices: ProxyHealth["prices"], readings: PlannedReading[], share = 1): number {
  let total = 0;
  readings.filter((r) => !r.reuse).forEach((r, i) => {
    const p = prices[r.request.model];
    const prefix = Math.ceil((codePoints(r.request.prompt.instructions) + r.request.blocks.filter((b) => b.kind !== "submission").reduce((n, b) => n + blockChars(b), 0)) / CHARS_PER_TOKEN);
    const rest = Math.max(0, r.tokensIn - prefix);
    const prefixRate = i === 0 ? (p.cache_write ?? 1) : (p.cache_read ?? 1);
    total += ((prefix * p.input * prefixRate + rest * p.input + r.tokensOut * p.output) / 1_000_000) * share + r.fallbackCost;
  });
  return total;
}

// --- Planning ----------------------------------------------------------------------------------------

export interface PlannedReading {
  submissionId: string;
  pseudonym: string;
  request: ReadingRequest;
  tokensIn: number;
  tokensOut: number;
  cost: number; // primary call, worst case (0 when reused)
  fallbackCost: number; // fallback call, worst case (0 when the fallback is off, or reused)
  reuse: Reusable | null; // an earlier reading of exactly this request, used instead of calling the model
}

/**
 * An earlier reading of exactly the same request: the same submission, its
 * same approved text, the same rubric and brief as sent, the same prompt
 * version and model. Reused only for that submission, never another.
 */
export interface Reusable {
  key: string; // requestKey of the request it answered
  model: string;
  from: string; // the call it came from: its request ID, or the proxy's request hash
  suggestions: AISuggestion[];
  warnings: string[]; // what the original reading warned the moderator of, shown again on reuse
}

export const REUSE = `${READINGS}/reuse`;

/** The key of a request: a hash of everything in it (model, prompt, rubric, brief, submission and their approvals, output schema). */
export const requestKey = (request: ReadingRequest) => sha256Text(JSON.stringify(request));

const ReuseEntry = z.strictObject({
  key: z.string(),
  submission_id: z.string(),
  model: z.string(),
  from: z.string().min(1),
  suggestions: z.array(AISuggestion),
  warnings: z.array(z.string()),
});

async function reusable(ws: Workspace, submissionId: string, request: ReadingRequest): Promise<Reusable | null> {
  const key = requestKey(request);
  const path = `${REUSE}/${key}.json`;
  if (!(await ws.exists(path))) return null;
  const parsed = ReuseEntry.safeParse(await ws.readJson(path).catch(() => null));
  // Never another submission's reading, and never one made for another request: the entry names both, and they must match (it fails closed).
  if (!parsed.success) return null;
  const e = parsed.data;
  if (e.key !== key || e.submission_id !== submissionId || e.model !== request.model || e.suggestions.some((s) => s.submission_id !== submissionId)) return null;
  return { key, model: e.model, from: e.from, suggestions: e.suggestions, warnings: e.warnings };
}

export interface Plan {
  provider: string | null; // the proxy's provider, as it reports it
  model: string;
  capUsd: number;
  fallbackModel: string | null;
  withBrief: boolean;
  /** Sent as one batch at the batch price (batch.ts), rather than one request at a time. */
  batch: boolean;
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
    await requireComplete(ws, "the brief", text);
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
  /** Ask the model again even where an earlier reading of exactly the same request could be reused. */
  rereadUnchanged?: boolean;
  /**
   * Send the run as one batch, at the batch price, with results within a day
   *. A batch has no automatic fallback: a reading the model declines is
   * reported, and can then be read one at a time, with the fallback.
   */
  batch?: boolean;
}

/** Everything that would be sent, with a worst-case estimate. Sends nothing. */
export async function planReadings(ws: Workspace, proxy: ReadingProxy, submissionIds: string[] | null = null, options: PlanOptions = {}): Promise<Plan> {
  const model = options.model ?? DEFAULT_MODEL;
  const capUsd = options.capUsd ?? DEFAULT_CAP_USD;
  const fallback = options.fallback ?? true;
  const withBrief = options.withBrief ?? true;
  if (!(capUsd > 0)) throw new ReadingError("the spend limit must be greater than 0");
  const { prices, provider, batch: canBatch } = await proxy.health();
  const batch = options.batch ?? false;
  if (batch && !canBatch) throw new ReadingError("the proxy's provider can't send a batch; read one submission at a time instead");
  const price = priceOf(prices, model);
  const share = batch ? (price.batch ?? 1) : 1; // the batch's share of the standard price
  if (fallback) priceOf(prices, FALLBACK_MODEL);
  const { rubric, brief } = await currentMaterial(ws, withBrief);
  const sample = (await loadRequest(ws)).sample;
  const known = new Map(sample.map((s) => [s.submission_id, s]));
  const plan: Plan = { provider, model, capUsd, fallbackModel: fallback ? FALLBACK_MODEL : null, withBrief, batch, readings: [], skipped: new Map() };
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
      await requireComplete(ws, id, text); // left out of the plan if anonymisation is no longer complete
      submission = { text, sha256: approval.approved_text_sha256 };
    } catch (err) {
      if (err instanceof UnapprovedText || err instanceof WorkspaceError) {
        plan.skipped.set(id, err.message);
        continue;
      }
      throw err;
    }
    const request = buildRequest(rubric, brief, s.pseudonym, submission, model);
    const [tokensIn, tokensOut, standard] = estimate(prices, request);
    const cost = standard * share;
    const fallbackCost = fallback && !batch ? estimate(prices, withModel(request, FALLBACK_MODEL))[2] : 0;
    // An earlier reading of exactly this request (or of its fallback's) is reused, at no cost, unless asked to read again.
    const reuse = options.rereadUnchanged
      ? null
      : ((await reusable(ws, id, request)) ?? (fallback ? await reusable(ws, id, withModel(request, FALLBACK_MODEL)) : null));
    plan.readings.push({ submissionId: id, pseudonym: s.pseudonym, request, tokensIn, tokensOut, cost: reuse ? 0 : cost, fallbackCost: reuse ? 0 : fallbackCost, reuse });
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
  cached: string[]; // readings whose call read the shared prefix from the provider's cache
  reused: string[]; // readings reused from an earlier reading of exactly the same request, with no call
  spentUsd: number;
}

/** The request as it would be sent now, from the current approved material, with what the call record needs. */
export interface Current {
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
export async function rebuild(ws: Workspace, planned: PlannedReading, plan: Plan, model: string): Promise<Current> {
  const current = await currentRequest(ws, plan.withBrief, planned.submissionId, planned.pseudonym, model, plan.provider);
  if (JSON.stringify(current.request) !== JSON.stringify(withModel(planned.request, model))) {
    throw new UnapprovedText("the submission, brief, or rubric changed after you confirmed the estimate; nothing was sent, so run the reading again");
  }
  return current;
}

/** The request for one submission from the current approved material, through the gate. Throws if it can't be sent. */
export async function currentRequest(ws: Workspace, withBrief: boolean, submissionId: string, pseudonym: string, model: string, provider: string | null): Promise<Current> {
  const { rubric, brief, briefApproval } = await currentMaterial(ws, withBrief);
  const [text, approval] = await approvedText(ws, submissionId);
  await requireApproved(ws, submissionId, text);
  if (brief) await requireApprovedBrief(ws, brief.text);
  const request = buildRequest(rubric, brief, pseudonym, { text, sha256: approval.approved_text_sha256 }, model);
  return { provider: provider ?? "unknown", request, text, approval, briefApproval, rubric };
}

/** Python's strftime("%Y%m%dT%H%M%S%f") in UTC (a Date has milliseconds, so the last three digits are 0). */
export const stampOf = (when: Date) => when.toISOString().replace(/[-:]/g, "").replace(/\.(\d{3})Z$/, "$1000");

/** Python's datetime.isoformat() of a UTC time: microseconds only when not zero, and "+00:00". */
export function isoformat(when: Date): string {
  const [base, ms] = when.toISOString().replace("Z", "").split(".");
  return `${base}${ms === "000" ? "" : `.${ms}000`}+00:00`;
}

/** A path under `readings/`, with a suffix if the name is already taken (two writes in one millisecond). */
export async function freePath(ws: Workspace, base: string): Promise<string> {
  let path = `${base}.json`;
  for (let n = 2; await ws.exists(path); n++) path = `${base}-${n}.json`;
  return path;
}

/** The proxy refused a request for the spend limit: nothing more can be sent in this run. */
class SpendLimitReached extends Error {}

/** Called as each reading starts, so a screen can say which one it is on (it changes nothing that is sent or recorded). */
export type ReadingProgress = (progress: { submissionId: string; index: number; total: number }) => void;

export async function runReadings(ws: Workspace, plan: Plan, options: { proxy: ReadingProxy; now?: () => Date; onProgress?: ReadingProgress }): Promise<RunResult> {
  if (plan.batch) throw new ReadingError("this plan is for a batch; send it with sendBatch");
  const now = options.now ?? (() => new Date());
  const result: RunResult = { read: new Map(), failed: new Map(), notRun: new Map(), warnings: new Map(), fallbacks: [], cached: [], reused: [], spentUsd: 0 };
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
      options.onProgress?.({ submissionId: planned.submissionId, index: i, total: plan.readings.length });
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

export function parseResponse(data: unknown): ProxyResponse {
  const response = data as ProxyResponse;
  if (response.outcome === "complete") {
    // The model's output must be the reading's shape; anything else is unparsed, never trusted.
    const parsed = ReadingOut.safeParse(response.parsed);
    return parsed.success ? { ...response, parsed: parsed.data } : { ...response, outcome: "unparsed", parsed: null };
  }
  return { ...response, parsed: null };
}

/**
 * Reuse an earlier reading of exactly the same request, if the request as it
 * would be sent now still matches it (the gate is checked again, as for any
 * reading). Nothing is sent. The copies say they were produced from the cache
 * and link to the call they came from. Returns false to read it live instead.
 */
export async function reuseReading(ws: Workspace, planned: PlannedReading, plan: Plan, result: RunResult, log: Record<string, unknown>[], now: () => Date): Promise<boolean> {
  const reuse = planned.reuse!;
  const id = planned.submissionId;
  let current: Current;
  try {
    current = await rebuild(ws, planned, plan, reuse.model);
  } catch (err) {
    if (err instanceof UnapprovedText || err instanceof WorkspaceError || err instanceof ReadingError) {
      result.failed.set(id, err.message);
      return true;
    }
    throw err;
  }
  if (requestKey(current.request) !== reuse.key) return false; // something changed since planning: read it live
  const at = now().toISOString();
  const suggestions = reuse.suggestions.map((s) =>
    AISuggestion.parse({
      ...s,
      call: { ...s.call, produced_by: "cache", cached_from_request_id: reuse.from, request_id: null, usage: TokenUsage.parse({}), timestamp: at },
      provenance: { ...s.provenance, source: `reused from model call ${reuse.from}`, timestamp: at },
    }),
  );
  await store(ws, id, suggestions, now());
  log.push({ submission_id: id, model: reuse.model, outcome: "reused", request_id: reuse.from, usage: TokenUsage.parse({}), cost_usd: 0 });
  result.read.set(id, suggestions);
  result.reused.push(id);
  if (reuse.warnings.length) result.warnings.set(id, reuse.warnings); // what the moderator was warned of then, still true
  if (reuse.model !== plan.model) result.fallbacks.push(id); // it was the fallback model's reading
  return true;
}

async function readOne(ws: Workspace, planned: PlannedReading, plan: Plan, proxy: ReadingProxy, runId: string, result: RunResult, log: Record<string, unknown>[], now: () => Date): Promise<void> {
  const id = planned.submissionId;
  if (planned.reuse && (await reuseReading(ws, planned, plan, result, log, now))) return;
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
        if (err.requestSha256) await recordFailedCall(ws, id, inputsOf(current!), model, fallbackFrom, err, log, now());
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
    call = callRecord(response, inputsOf(current), model, fallbackFrom, now());
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
  await keepReading(ws, id, response, current, call, result, now);
}

/** A complete reading: its suggestions stored, kept for reuse by exactly the same request, and reported. */
export async function keepReading(ws: Workspace, id: string, response: ProxyResponse, current: Current, call: ModelCall, result: RunResult, now: () => Date): Promise<void> {
  const [suggestions, warnings] = toSuggestions(response.parsed as ReadingOut, current, call, id, now());
  await store(ws, id, suggestions, now());
  // For this submission only. The reading is already stored, so failing to keep a copy for reuse only means it will be read live next time.
  const key = requestKey(current.request);
  await ws
    .writeJson(`${REUSE}/${key}.json`, { key, submission_id: id, model: call.model_requested, from: call.request_id || call.request_sha256, suggestions, warnings }, { private: true })
    .catch(() => {});
  result.read.set(id, suggestions);
  if (call.usage.cache_read_tokens > 0) result.cached.push(id); // from the call itself, whatever it suggested
  if (warnings.length) result.warnings.set(id, warnings);
}

/**
 * A call the proxy forwarded but the provider failed (a server error, a
 * rejected key): a call record with the error and no response, and a line in
 * the run log, so every forwarded request stays traceable. There is no raw
 * response to keep.
 */
/** What a call record says of the request: its provider, and the rubric and approvals it was built from. */
export interface CallInputs {
  provider: string;
  rubric_version: string;
  approval_id: string;
  approved_text_sha256: string;
  brief_approval_id: string | null;
  brief_sha256: string | null;
}

export const inputsOf = (current: Current): CallInputs => ({
  provider: current.provider,
  rubric_version: current.rubric.version,
  approval_id: current.approval.id,
  approved_text_sha256: current.approval.approved_text_sha256,
  brief_approval_id: current.briefApproval?.id ?? null,
  brief_sha256: current.briefApproval?.approved_text_sha256 ?? null,
});

export async function recordFailedCall(
  ws: Workspace,
  id: string,
  inputs: CallInputs,
  model: string,
  fallbackFrom: string | null,
  err: ProviderError,
  log: Record<string, unknown>[],
  when: Date,
  producedBy: "live" | "batch" = "live",
): Promise<void> {
  const call = ModelCall.parse({
    ...inputs,
    model_requested: model,
    model_reported: null,
    request_id: null,
    prompt_version: PROMPT_VERSION,
    fallback_from: fallbackFrom,
    request_sha256: err.requestSha256,
    response_sha256: null,
    stop_reason: null,
    usage: TokenUsage.parse({}),
    produced_by: producedBy,
    timestamp: when.toISOString(),
    error: err.message,
  });
  const record = await freePath(ws, `${READINGS}/calls/${id}--${stampOf(when)}--${model}`);
  await ws.writeJson(record, { outcome: "provider_error", call }, { private: true });
  log.push({ submission_id: id, model, outcome: "provider_error", request_id: null, usage: call.usage, cost_usd: 0 });
}

export function callRecord(response: ProxyResponse, inputs: CallInputs, model: string, fallbackFrom: string | null, when: Date, producedBy: "live" | "batch" = "live"): ModelCall {
  return ModelCall.parse({
    ...inputs,
    provider: response.provider,
    model_requested: model,
    model_reported: response.model_reported,
    request_id: response.request_id,
    prompt_version: PROMPT_VERSION,
    fallback_from: fallbackFrom,
    request_sha256: response.request_sha256, // the proxy's hash of exactly what it sent
    response_sha256: sha256Text(response.raw_json),
    stop_reason: response.stop_reason,
    usage: TokenUsage.parse(response.usage),
    produced_by: producedBy,
    timestamp: when.toISOString(),
    error: response.outcome === "complete" ? null : response.outcome,
  });
}

/** Every call, whatever its outcome, leaves its record and raw response. */
export async function recordCall(ws: Workspace, id: string, call: ModelCall, response: ProxyResponse, when: Date): Promise<void> {
  const stamp = `${stampOf(when)}--${call.model_requested}`;
  const record = await freePath(ws, `${READINGS}/calls/${id}--${stamp}`);
  await ws.writeJson(record, { outcome: response.outcome, call }, { private: true });
  const raw = record.replace(`${READINGS}/calls/`, `${READINGS}/raw/`);
  await ws.writeJson(raw, JSON.parse(response.raw_json), { private: true });
}

function toSuggestions(out: ReadingOut, current: Current, call: ModelCall, submissionId: string, when: Date): [AISuggestion[], string[]] {
  const rubric = current.rubric;
  const warnings: string[] = [];
  const byId = new Map(out.criteria.map((r) => [r.criterion_id, r]));
  const unknown = [...byId.keys()].filter((cid) => !rubric.criteria.some((c) => c.id === cid));
  if (unknown.length) warnings.push(`ignored readings for unknown criteria: ${unknown.join(", ")}`);
  const suggestions: AISuggestion[] = [];
  // One token for this call's reading: its suggestions' ids are its own, even if another call returns the same response.
  const reading = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("");
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
        // Unique to this reading, so a later reading never reuses a suggestion's id.
        id: `ai-${submissionId}-${String(index + 1).padStart(2, "0")}-${reading}`,
        submission_id: submissionId,
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

export async function writeLog(ws: Workspace, started: Date, plan: Plan, result: RunResult, log: Record<string, unknown>[]): Promise<void> {
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
