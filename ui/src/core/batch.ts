/**
 * Batch processing (ADR 0005): a run's readings sent together through
 * the proxy, at the provider's batch price, with results within a day.
 *
 * Sending checks everything a single reading does: each request is rebuilt
 * from the current approved material and must equal the plan the moderator
 * confirmed, and the proxy checks each against the rules on what the AI may be sent and
 * refuses the whole batch if any one fails. Reused readings are reused at
 * once, with nothing sent.
 *
 * What was sent is kept in the workspace (`readings/batches/<id>.json`), so a
 * batch can be checked and collected after a reload, or on another day. On
 * collection, each result is kept only if the request as it would be sent now
 * is still exactly the one that was sent (the same approved texts, rubric,
 * brief, approvals and model); otherwise it is reported, and the submission
 * can be read again. Results are recorded as produced by batch.
 *
 * A batch has no automatic fallback. A reading the model declined, or one
 * that errored or expired in the batch, is reported and can then be read one
 * at a time, with the fallback.
 */

import * as z from "zod";
import { UnapprovedText } from "./boundary.ts";
import {
  type CallInputs,
  callRecord,
  type Current,
  currentRequest,
  estimatedCost,
  freePath,
  inputsOf,
  isoformat,
  keepReading,
  parseResponse,
  type Plan,
  READINGS,
  ReadingError,
  type ReadingProxy,
  type ReadingRequest,
  rebuild,
  recordCall,
  recordFailedCall,
  requestKey,
  reuseReading,
  type RunResult,
  stampOf,
} from "./reading.ts";
import { pyFormatG, pyRound } from "./pytext.ts";
import { ProviderError, ProxyRefusal, type Workspace, WorkspaceError } from "./workspace.ts";

export const BATCHES = `${READINGS}/batches`;

const BatchId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const Hash = z.string().regex(/^[0-9a-f]{64}$/);

const SentItem = z.strictObject({
  custom_id: z.string(),
  submission_id: z.string(),
  pseudonym: z.string(),
  request_key: Hash, // requestKey of the request sent
  request_sha256: Hash, // the proxy's hash of what it sent
  // What the call record says of the request as sent, so every result is recorded, kept or not.
  rubric_version: z.string(),
  approval_id: z.string(),
  approved_text_sha256: Hash,
  brief_approval_id: z.string().nullable(),
  brief_sha256: Hash.nullable(),
});

/** A batch as the workspace records it: what was sent, and whether its results have been collected. */
export const SentBatch = z.strictObject({
  id: BatchId,
  run_id: z.string(),
  sent_at: z.string(),
  provider: z.string(),
  model: z.string(),
  prompt_version: z.string().default("reading-v2"), // batches sent before it was recorded were all moderation readings
  with_brief: z.boolean(),
  cap_usd: z.number(),
  estimated_usd: z.number(),
  items: z.array(SentItem).min(1),
  collected_at: z.string().nullable(),
});
export type SentBatch = z.output<typeof SentBatch>;

/** How far a batch has got, as the provider reports it. */
export const BatchProgress = z.object({
  id: BatchId,
  status: z.enum(["in_progress", "canceling", "ended"]),
  counts: z.object({ processing: z.int(), succeeded: z.int(), errored: z.int(), canceled: z.int(), expired: z.int() }),
  created_at: z.string(),
  expires_at: z.string(),
  ended_at: z.string().nullable(),
});
export type BatchProgress = z.output<typeof BatchProgress>;

const Sent = BatchProgress.extend({ items: z.array(z.object({ custom_id: z.string(), request_sha256: Hash })) });
const Results = z.object({
  id: BatchId,
  items: z.array(z.looseObject({ custom_id: z.string(), request_sha256: Hash, cost_usd: z.number(), failed: z.string().optional(), message: z.string().optional() })),
});

export const batchPath = (id: string) => `${BATCHES}/${id}.json`;

export interface BatchSendResult {
  /** The batch sent, or null if nothing needed sending (everything was reused, failed the gate, or didn't fit the limit). */
  batch: SentBatch | null;
  /** What happened without the batch: readings reused at once, and those not sent, with why. */
  result: RunResult;
}

const emptyResult = (): RunResult => ({ read: new Map(), failed: new Map(), notRun: new Map(), warnings: new Map(), fallbacks: [], cached: [], reused: [], spentUsd: 0 });

/** The batches sent from this workspace whose results haven't been collected yet, oldest first. */
export async function pendingBatches(ws: Workspace): Promise<SentBatch[]> {
  if (!(await ws.exists(BATCHES))) return [];
  const batches: SentBatch[] = [];
  for (const entry of await ws.fs.list(BATCHES)) {
    if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
    batches.push(await loadBatch(ws, entry.name.slice(0, -".json".length)));
  }
  return batches.filter((b) => !b.collected_at).sort((a, b) => a.sent_at.localeCompare(b.sent_at));
}

export async function loadBatch(ws: Workspace, id: string): Promise<SentBatch> {
  if (!BatchId.safeParse(id).success) throw new WorkspaceError(`'${id}' is not a batch id`);
  const path = batchPath(id);
  if (!(await ws.exists(path))) throw new WorkspaceError(`no batch ${id} was sent from this workspace`);
  const parsed = SentBatch.safeParse(await ws.readJson(path));
  if (!parsed.success || parsed.data.id !== id) throw new WorkspaceError(`${path} is not a valid batch record`);
  return parsed.data;
}

/**
 * Send a batch plan (planReadings with `batch: true`) as one batch. Only one
 * batch at a time is waiting in a workspace, so no submission is sent twice.
 */
export async function sendBatch(ws: Workspace, plan: Plan, options: { proxy: ReadingProxy; now?: () => Date }): Promise<BatchSendResult> {
  if (!plan.batch) throw new ReadingError("this plan isn't for a batch; send it with runReadings");
  const now = options.now ?? (() => new Date());
  const waiting = await pendingBatches(ws);
  if (waiting.length) {
    throw new ReadingError(`a batch sent on ${waiting[0].sent_at.slice(0, 10)} is still waiting; collect its results or cancel it first`);
  }
  const result = emptyResult();
  const log: Record<string, unknown>[] = [];
  const started = now();
  let runId: string;
  try {
    runId = (await options.proxy.openRun(plan.capUsd, estimatedCost(plan))).id;
  } catch (err) {
    if (err instanceof ProxyRefusal || err instanceof WorkspaceError) throw new ReadingError(err.message);
    throw err;
  }

  // Reused readings at once; the rest rebuilt through the gate, while they fit the limit.
  const toSend: { id: string; pseudonym: string; current: Current }[] = [];
  let committed = 0;
  for (const [i, planned] of plan.readings.entries()) {
    if (planned.reuse && (await reuseReading(ws, planned, plan, result, log, now))) continue;
    if (committed + planned.cost > plan.capUsd) {
      for (const later of plan.readings.slice(i)) {
        if (!result.read.has(later.submissionId)) result.notRun.set(later.submissionId, `the $${pyFormatG(plan.capUsd)} spend limit would be exceeded`);
      }
      break;
    }
    try {
      toSend.push({ id: planned.submissionId, pseudonym: planned.pseudonym, current: await rebuild(ws, planned, plan, plan.model) });
      committed += planned.cost;
    } catch (err) {
      if (err instanceof UnapprovedText || err instanceof WorkspaceError || err instanceof ReadingError) result.failed.set(planned.submissionId, err.message);
      else throw err;
    }
  }
  if (!toSend.length) {
    await writeBatchLog(ws, started, plan, null, result, log);
    return { batch: null, result };
  }

  let sent: z.output<typeof Sent>;
  try {
    sent = Sent.parse(await options.proxy.sendBatch(runId, toSend.map((s) => s.current.request), ws.registration.registration_id));
  } catch (err) {
    if (err instanceof ProviderError) {
      // Forwarded, then failed: each request leaves a record of the failed call.
      for (const [i, s] of toSend.entries()) {
        const hash = err.requestSha256s[i];
        if (hash) await recordFailedCall(ws, s.id, inputsOf(s.current), plan.model, null, new ProviderError(err.message, err.fatal, hash), log, now(), "batch");
        result.failed.set(s.id, err.message);
      }
      await writeBatchLog(ws, started, plan, null, result, log);
      if (err.fatal) throw new ReadingError(err.message);
      return { batch: null, result };
    }
    if (err instanceof ProxyRefusal) {
      // The proxy refused the batch, so nothing was sent. It names the request by its place in the batch.
      const message = err.message.replace(/^request (\d+): /, (_, n: string) => `${toSend[Number(n) - 1]?.id ?? `request ${n}`}: `);
      if (err.type === "spend") {
        for (const s of toSend) result.notRun.set(s.id, message);
        await writeBatchLog(ws, started, plan, null, result, log);
        return { batch: null, result };
      }
      throw new ReadingError(`nothing was sent: ${message}`);
    }
    if (err instanceof z.ZodError) throw new ReadingError("the proxy's reply to the batch was not understood; check the proxy before sending again");
    throw err;
  }
  if (sent.items.length !== toSend.length || sent.items.some((item, i) => item.custom_id !== `r${i + 1}`)) {
    await options.proxy.cancelBatch(sent.id).catch(() => {});
    throw new ReadingError(`the proxy's reply didn't match the batch sent, so it was cancelled (${sent.id}); read the submissions again`);
  }

  const batch = SentBatch.parse({
    id: sent.id,
    run_id: runId,
    sent_at: started.toISOString(),
    provider: plan.provider ?? "unknown",
    model: plan.model,
    prompt_version: toSend[0].current.request.prompt.version, // one workspace, so one set of instructions
    with_brief: plan.withBrief,
    cap_usd: plan.capUsd,
    estimated_usd: pyRound(estimatedCost(plan), 6),
    items: toSend.map((s, i) => ({
      custom_id: sent.items[i].custom_id,
      submission_id: s.id,
      pseudonym: s.pseudonym,
      request_key: requestKey(s.current.request),
      request_sha256: sent.items[i].request_sha256,
      rubric_version: s.current.rubric.version,
      approval_id: s.current.approval.id,
      approved_text_sha256: s.current.approval.approved_text_sha256,
      brief_approval_id: s.current.briefApproval?.id ?? null,
      brief_sha256: s.current.briefApproval?.approved_text_sha256 ?? null,
    })),
    collected_at: null,
  });
  try {
    await ws.writeJson(batchPath(batch.id), batch, { private: true });
  } catch (err) {
    // Without its record the batch could never be collected here: cancel it rather than leave it untracked.
    await options.proxy.cancelBatch(batch.id).catch(() => {});
    throw new ReadingError(`the batch was sent but couldn't be recorded in the workspace, so it was cancelled (${batch.id}): ${(err as Error).message}`);
  }
  for (const item of batch.items) log.push({ submission_id: item.submission_id, model: plan.model, outcome: "batch_submitted", batch_id: batch.id, request_sha256: item.request_sha256 });
  await writeBatchLog(ws, started, plan, batch, result, log);
  return { batch, result };
}

/** How far a batch has got. */
export async function checkBatch(proxy: ReadingProxy, id: string): Promise<BatchProgress> {
  try {
    return BatchProgress.parse(await proxy.batchStatus(id));
  } catch (err) {
    throw asReadingError(err);
  }
}

/** Stop a batch: requests not yet processed are not billed. Its results can then be collected once it has ended. */
export async function cancelBatch(proxy: ReadingProxy, id: string): Promise<BatchProgress> {
  try {
    return BatchProgress.parse(await proxy.cancelBatch(id));
  } catch (err) {
    throw asReadingError(err);
  }
}

function asReadingError(err: unknown): unknown {
  if (err instanceof ProxyRefusal || err instanceof ProviderError || err instanceof WorkspaceError) return new ReadingError(err.message);
  if (err instanceof z.ZodError) return new ReadingError("the proxy's reply about the batch was not understood");
  return err;
}

/**
 * Collect an ended batch's results: each kept as a reading if what would be
 * sent now is exactly what was sent, and every call recorded, as a live
 * reading's is. Once collected, the batch is marked so.
 */
export async function collectBatch(ws: Workspace, proxy: ReadingProxy, id: string, options: { now?: () => Date } = {}): Promise<RunResult> {
  const now = options.now ?? (() => new Date());
  const batch = await loadBatch(ws, id);
  if (batch.collected_at) throw new ReadingError(`the results of batch ${id} were collected on ${batch.collected_at.slice(0, 10)}`);
  let results: z.output<typeof Results>;
  try {
    results = Results.parse(await proxy.batchResults(id));
  } catch (err) {
    throw asReadingError(err);
  }
  const byId = new Map(results.items.map((r) => [r.custom_id, r]));
  const result = emptyResult();
  const log: Record<string, unknown>[] = [];
  const started = now();

  for (const item of batch.items) {
    const sid = item.submission_id;
    const r = byId.get(item.custom_id);
    if (!r || r.request_sha256 !== item.request_sha256) {
      result.failed.set(sid, "no result came back for it; read it again");
      continue;
    }
    // The call record says what was sent, from the batch's record, whatever has changed since.
    const sentInputs: CallInputs = {
      provider: batch.provider,
      prompt_version: batch.prompt_version,
      rubric_version: item.rubric_version,
      approval_id: item.approval_id,
      approved_text_sha256: item.approved_text_sha256,
      brief_approval_id: item.brief_approval_id,
      brief_sha256: item.brief_sha256,
    };
    if (r.failed) {
      const message = r.message ?? `the request ${r.failed} in the batch`;
      await recordFailedCall(ws, sid, sentInputs, batch.model, null, new ProviderError(message, false, item.request_sha256), log, now(), "batch");
      result.failed.set(sid, `${message}; read it again, one at a time`);
      continue;
    }
    // Every result is recorded, with its raw response, before deciding whether to keep it.
    const response = parseResponse(r);
    result.spentUsd += response.cost_usd;
    const call = callRecord(response, sentInputs, batch.model, null, now(), "batch");
    await recordCall(ws, sid, call, response, now());
    log.push({ submission_id: sid, model: batch.model, outcome: response.outcome, batch_id: id, request_id: response.request_id, usage: call.usage, cost_usd: pyRound(response.cost_usd, 6) });

    let current: Current | null = null;
    try {
      current = await currentRequest(ws, batch.with_brief, sid, item.pseudonym, batch.model, batch.provider);
    } catch (err) {
      if (!(err instanceof UnapprovedText || err instanceof WorkspaceError || err instanceof ReadingError)) throw err;
    }
    const unchanged =
      current !== null &&
      requestKey(current.request) === item.request_key &&
      current.approval.id === item.approval_id &&
      (current.briefApproval?.id ?? null) === item.brief_approval_id;
    if (response.outcome === "refused") {
      result.failed.set(sid, `${batch.model} declined to read it; read it again one at a time, and the fallback model is asked if it declines again`);
    } else if (response.outcome !== "complete") {
      result.failed.set(sid, `the reading was incomplete (${response.outcome}, stop reason: ${response.stop_reason})`);
    } else if (!unchanged) {
      // It answers a request that would no longer be sent: recorded above, but not kept as a reading.
      result.failed.set(sid, "the submission, brief, rubric or an approval changed after the batch was sent, so its reading wasn't kept; read it again");
      log.push({ submission_id: sid, model: batch.model, outcome: "not_kept_changed", batch_id: id, request_sha256: item.request_sha256 });
    } else {
      await keepReading(ws, sid, response, current!, call, result, now);
    }
  }

  await ws.writeJson(batchPath(id), { ...batch, collected_at: now().toISOString() }, { private: true });
  await writeBatchLog(ws, started, null, batch, result, log);
  return result;
}

/** A run log, as a live run's, for sending or collecting a batch. */
async function writeBatchLog(ws: Workspace, started: Date, plan: Plan | null, batch: SentBatch | null, result: RunResult, log: Record<string, unknown>[]): Promise<void> {
  await ws.writeJson(
    await freePath(ws, `${READINGS}/runs/${stampOf(started)}`),
    {
      started: isoformat(started),
      provider: plan?.provider ?? batch?.provider ?? null,
      model: plan?.model ?? batch?.model ?? null,
      with_brief: plan?.withBrief ?? batch?.with_brief ?? null,
      batch: batch ? { id: batch.id, action: plan ? "sent" : "collected" } : null,
      cap_usd: plan?.capUsd ?? batch?.cap_usd ?? null,
      estimated_usd: plan ? pyRound(estimatedCost(plan), 6) : null,
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
