/**
 * The local Feedbacker proxy (ADR 0004): the only way anything leaves the
 * machine, and the only holder of the API key.
 *
 * API (all under /api, same-origin with the session token):
 *   GET  /api/health                  whether a key is configured, and model prices
 *   POST /api/runs                    open a run: { limit_usd, estimate_usd, confirmed: true }
 *   GET  /api/runs/:id                a run's limit and spend
 *   POST /api/runs/:id/read           send one reading request (see boundary.ts)
 *   POST /api/runs/:id/batch          { requests: [...] }, sent together at the batch price
 *   GET  /api/batches/:id             how far a batch this proxy sent has got
 *   GET  /api/batches/:id/results     its results, once it has ended
 *   POST /api/batches/:id/cancel      stop it; requests not yet processed are not billed
 *   POST /api/workspaces              { action: "create" | "register", path }
 *   POST /api/workspaces/confirm      { registration_id }
 *   POST /api/workspaces/forget       { registration_id }, once the workspace is deleted
 * Everything else serves the app.
 */

import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import * as z from "zod";
import { type BatchItem, BatchId, type Batches } from "./batches.ts";
import { checkBoundary, checkLeaks, ReadRequest, Refusal, renderBlock } from "./boundary.ts";
import type { EgressLog } from "./egress.ts";
import { BATCH, CACHE_WRITE, cost, PRICES, worstCase } from "./pricing.ts";
import { type BatchStatus, ProviderError, type Provider, type ProviderRequest, type ProviderResult } from "./provider.ts";
import type { Runs } from "./runs.ts";
import { apiGuard, hostCheck, securityHeaders, type Session } from "./security.ts";
import { serveApp } from "./static.ts";
import type { Workspaces } from "./workspaces.ts";

export interface Deps {
  session: Session;
  /** Null when no key is configured: workspaces still work, model requests are refused. */
  provider: Provider | null;
  runs: Runs;
  batches: Batches;
  egress: EgressLog;
  workspaces: Workspaces;
  appDir: string | null;
  /**
   * Values that must never be sent to a provider or returned to the app: the
   * configured API key(s). A request containing one is refused, and any that
   * appears in a result is redacted.
   */
  secrets: string[];
  now?: () => Date;
}

const OpenRun = z.strictObject({
  limit_usd: z.number(),
  estimate_usd: z.number(),
  confirmed: z.literal(true, { message: "the moderator must confirm the estimate before a run opens" }),
});
const WorkspaceAction = z.strictObject({
  action: z.enum(["create", "register"]),
  path: z.string().min(1),
  retention_days: z.int().min(1).optional(),
  retention_source: z.string().min(1).max(200).optional(),
});
const Confirm = z.strictObject({ registration_id: z.string().min(1).max(100), challenge: z.boolean().optional() });
const Forget = z.strictObject({ registration_id: z.string().min(1).max(100) });
/**
 * More than any moderation sample (the provider allows many more), and a bound
 * on the whole body, which is read before it is validated.
 */
export const MAX_BATCH = 200;
export const MAX_BATCH_BYTES = 32 * 1024 * 1024;
const BatchRequest = z.strictObject({ workspace: z.string().min(1).max(100), requests: z.array(ReadRequest).min(1).max(MAX_BATCH) });

const STATUS: Record<Refusal["type"], 409 | 422 | 503> = {
  boundary: 422,
  leak: 422,
  model: 422,
  run: 409,
  spend: 409,
  key: 503,
  batch: 409,
};

const refused = (c: Context, r: Refusal) => c.json({ error: { type: r.type, message: r.message } }, STATUS[r.type]);

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let data: unknown;
  try {
    data = await c.req.json();
  } catch {
    throw new Refusal("boundary", "the request body is not JSON");
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
    throw new Refusal("boundary", `the request is not allowed: ${issues.join("; ")}`);
  }
  return result.data;
}

const sha256Json = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const codePoints = (s: string) => [...s].length;
/** An own property only: `toString` or `__proto__` must not count as a priced model. */
const isPriced = (model: string) => Object.hasOwn(PRICES, model);

/** Replace every secret in every string of `value`, however deeply nested. */
function redact<T>(value: T, secrets: string[]): T {
  if (!secrets.length) return value;
  if (typeof value === "string") return secrets.reduce((s, secret) => s.replaceAll(secret, "[REDACTED]"), value) as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, secrets)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [redact(k, secrets), redact(v, secrets)])) as T;
  }
  return value;
}

/** A request that passed every check, as it will be sent, with the hash the call records keep. */
interface Prepared {
  request: ReadRequest;
  outgoing: ProviderRequest;
  requestSha256: string;
  worst: number;
}

function prepare(deps: Deps, request: ReadRequest, batch: boolean): Prepared {
  if (!deps.provider) throw new Refusal("key", "no API key is configured: set ANTHROPIC_API_KEY or put it in ~/Feedbacker/.env");
  if (deps.secrets.some((secret) => JSON.stringify(request).includes(secret))) {
    throw new Refusal("leak", "not sent, because it contains the proxy's API key");
  }
  if (!isPriced(request.model)) {
    throw new Refusal("model", `no price is known for model '${request.model}', so its spend can't be bounded; known: ${Object.keys(PRICES).join(", ")}`);
  }
  checkBoundary(request);
  checkLeaks(request);
  const outgoing: ProviderRequest = {
    model: request.model,
    max_output_tokens: request.max_output_tokens,
    instructions: request.prompt.instructions,
    blocks: request.blocks.map(renderBlock),
    shared_blocks: request.blocks.length - 1, // all but the submission, which boundary.ts requires to be last
    output_schema: request.output_schema,
  };
  // The hash is of what is sent, as before caching: the cache breakpoint's position isn't content.
  const { shared_blocks: _, ...sent } = outgoing;
  // The output schema is sent too, and billed as input.
  const chars =
    codePoints(outgoing.instructions) +
    outgoing.blocks.reduce((n, b) => n + codePoints(b), 0) +
    codePoints(JSON.stringify(outgoing.output_schema));
  return { request, outgoing, requestSha256: sha256Json(sent), worst: worstCase(request.model, chars, request.max_output_tokens, batch) };
}

/** A provider with the whole batch API; without it, runs are read request by request. */
const canBatch = (provider: Provider | null): provider is Required<Provider> =>
  !!provider && !!provider.createBatch && !!provider.batchStatus && !!provider.batchResults && !!provider.cancelBatch;

/** What the app is told of a batch: the provider's status, and how many requests it holds. */
const batchView = (status: BatchStatus, requests: number) => ({ ...status, requests });

export function createApp(deps: Deps): Hono {
  const now = deps.now ?? (() => new Date());
  const app = new Hono();

  app.use("*", securityHeaders, hostCheck(deps.session));
  app.use("/api/*", apiGuard(deps.session));

  app.onError((err, c) => {
    if (err instanceof Refusal) return refused(c, err);
    // Never echo internals: they could carry request content.
    return c.json({ error: { type: "internal", message: "the proxy failed to handle the request" } }, 500);
  });

  // Prices (USD per million tokens) let the app show a worst-case estimate before
  // anything is sent; the provider's other details stay here.
  // With the cache multipliers, so the app can show what caching the shared prefix is likely to save.
  const prices = Object.fromEntries(
    Object.entries(PRICES).map(([model, p]) => [model, { input: p.input, output: p.output, cache_read: p.cacheRead, cache_write: CACHE_WRITE, batch: BATCH }]),
  );
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      key_configured: deps.provider !== null,
      provider: deps.provider?.name ?? null,
      batch: canBatch(deps.provider),
      models: Object.keys(PRICES),
      prices,
    }),
  );

  app.post("/api/runs", async (c) => {
    const { limit_usd, estimate_usd } = await body(c, OpenRun);
    const run = deps.runs.open(limit_usd, estimate_usd, now());
    return c.json(run, 201);
  });

  app.get("/api/runs/:id", (c) => c.json(deps.runs.get(c.req.param("id"))));

  app.post("/api/runs/:id/read", async (c) => {
    const time = now();
    const run = deps.runs.get(c.req.param("id"));
    let request: ReadRequest | null = null;
    const refuse = (r: Refusal) => {
      // The request isn't trusted, so log only what is allowlisted: a priced
      // model name, and never the app-supplied prompt version.
      deps.egress.record({
        time: time.toISOString(),
        run_id: run.id,
        model: request && isPriced(request.model) ? request.model : null,
        prompt_version: null,
        request_sha256: null,
        outcome: "refused_by_proxy",
        refusal: r.type,
        usage: null,
        cost_usd: null,
      });
      return refused(c, r);
    };

    let prepared: Prepared;
    try {
      request = await body(c, ReadRequest);
      prepared = prepare(deps, request, false);
      deps.runs.reserve(run, prepared.worst);
    } catch (err) {
      if (err instanceof Refusal) return refuse(err);
      throw err;
    }
    const { outgoing, requestSha256, worst } = prepared;

    try {
      const result = redact(await deps.provider!.read(outgoing), deps.secrets);
      const spent = cost(request.model, result.usage);
      deps.runs.settle(run, worst, spent);
      deps.egress.record({
        time: time.toISOString(),
        run_id: run.id,
        model: request.model,
        prompt_version: request.prompt.version,
        request_sha256: requestSha256,
        outcome: result.outcome,
        refusal: null,
        usage: result.usage,
        cost_usd: spent,
      });
      return c.json({
        ...result,
        provider: deps.provider!.name,
        request_sha256: requestSha256,
        cost_usd: spent,
        run: { id: run.id, limit_usd: run.limit_usd, spent_usd: run.spent_usd },
      });
    } catch (err) {
      deps.runs.settle(run, worst, 0);
      const message = err instanceof ProviderError ? err.message : "the request to the provider failed";
      const fatal = err instanceof ProviderError ? err.fatal : false;
      deps.egress.record({
        time: time.toISOString(),
        run_id: run.id,
        model: request.model,
        prompt_version: request.prompt.version,
        request_sha256: requestSha256,
        outcome: "provider_error",
        refusal: null,
        usage: null,
        cost_usd: 0,
      });
      // The request was forwarded, so its hash lets the app keep an audit record of the failed call.
      return c.json({ error: { type: "provider", message, fatal, request_sha256: requestSha256 } }, 502);
    }
  });

  /** The provider's batch API, or a refusal: without it a run is read request by request. */
  const batchApi = () => {
    const provider = deps.provider;
    if (!provider) throw new Refusal("key", "no API key is configured: set ANTHROPIC_API_KEY or put it in ~/Feedbacker/.env");
    if (!canBatch(provider)) throw new Refusal("batch", `the ${provider.name} provider has no batch API here; read without batching`);
    return provider;
  };
  const providerFailed = (c: Context, err: unknown, extra: Record<string, unknown> = {}) => {
    const message = err instanceof ProviderError ? err.message : "the request to the provider failed";
    const fatal = err instanceof ProviderError ? err.fatal : false;
    return c.json({ error: { type: "provider", message, fatal, ...extra } }, 502);
  };
  const batchParam = (c: Context) => {
    const id = BatchId.safeParse(c.req.param("id"));
    if (!id.success) throw new Refusal("batch", "not a batch id");
    return deps.batches.get(id.data);
  };

  // Workspaces with a batch being sent: with the batch record's waiting check, at most one batch per workspace,
  // whichever window sends it. Checked and taken with no await in between.
  const sending = new Set<string>();

  // Every request is checked as a single reading is, and the whole batch is
  // refused, with nothing sent, if any one is. The spend reserved is every
  // request's worst case at the batch price; it is settled when the results are collected.
  app.post(
    "/api/runs/:id/batch",
    bodyLimit({
      maxSize: MAX_BATCH_BYTES,
      onError: (c) => refused(c, new Refusal("boundary", `the batch is larger than ${MAX_BATCH_BYTES / 1024 / 1024} MB; send it in smaller batches`)),
    }),
    async (c) => {
      const time = now();
      const run = deps.runs.get(c.req.param("id"));
      let requests: ReadRequest[] = [];
      let workspace = "";
      let prepared: Prepared[];
      try {
        batchApi();
        ({ requests, workspace } = await body(c, BatchRequest));
        if (!deps.workspaces.has(workspace)) throw new Refusal("batch", "no such workspace is registered with this proxy");
        // The record must be usable before anything is sent: a batch the proxy can't record could never be collected.
        try {
          deps.batches.check();
        } catch {
          return c.json({ error: { type: "internal", message: `nothing was sent: the batch record ${deps.batches.path} can't be read or written` } }, 500);
        }
        const waiting = deps.batches.waiting(workspace, time);
        if (waiting || sending.has(workspace)) {
          throw new Refusal("batch", `a batch for this workspace is still waiting${waiting ? ` (${waiting.id})` : ""}; collect its results or cancel it first`);
        }
        prepared = requests.map((request, i) => {
          try {
            return prepare(deps, request, true);
          } catch (err) {
            if (err instanceof Refusal) throw new Refusal(err.type, `request ${i + 1}: ${err.message}`);
            throw err;
          }
        });
        deps.runs.reserve(run, prepared.reduce((n, p) => n + p.worst, 0));
        sending.add(workspace);
      } catch (err) {
        if (!(err instanceof Refusal)) throw err;
        deps.egress.record({
          time: time.toISOString(),
          run_id: run.id,
          model: null,
          prompt_version: null,
          request_sha256: null,
          outcome: "refused_by_proxy",
          refusal: err.type,
          usage: null,
          cost_usd: null,
        });
        return refused(c, err);
      }
      try {
        const reserved = prepared.reduce((n, p) => n + p.worst, 0);
        const items: BatchItem[] = prepared.map((p, i) => ({
          custom_id: `r${i + 1}`,
          model: p.request.model,
          prompt_version: p.request.prompt.version,
          request_sha256: p.requestSha256,
          worst_usd: p.worst,
        }));
        const log = (outcome: string, batchId?: string) =>
          items.forEach((item) =>
            deps.egress.record({
              time: time.toISOString(),
              run_id: run.id,
              model: item.model,
              prompt_version: item.prompt_version,
              request_sha256: item.request_sha256,
              outcome,
              refusal: null,
              usage: null,
              cost_usd: outcome === "provider_error" ? 0 : null,
              ...(batchId ? { batch_id: batchId } : {}),
            }),
          );
        let status: BatchStatus;
        try {
          status = await batchApi().createBatch(prepared.map((p, i) => ({ custom_id: items[i].custom_id, request: p.outgoing })));
        } catch (err) {
          deps.runs.settle(run, reserved, 0);
          log("provider_error");
          // The requests were forwarded, so their hashes let the app keep an audit record of each failed call.
          return providerFailed(c, err, { request_sha256s: items.map((i) => i.request_sha256) });
        }
        try {
          deps.batches.add({ id: status.id, run_id: run.id, workspace, created_at: time.toISOString(), items, collected_at: null });
        } catch {
          // Sent but not recorded, so its results could never be collected: cancel it at once. The reservation stays
          // held, since some requests may already have been processed and billed, and the log keeps the batch ID.
          await batchApi()
            .cancelBatch(status.id)
            .catch(() => {});
          log("batch_cancelled_unrecorded", status.id);
          return c.json({ error: { type: "internal", message: `the batch was sent but couldn't be recorded, so it was cancelled (${status.id}); read the submissions again` } }, 500);
        }
        log("batch_submitted", status.id);
        return c.json(
          {
            ...batchView(status, items.length),
            provider: deps.provider!.name,
            items: items.map((i) => ({ custom_id: i.custom_id, request_sha256: i.request_sha256 })),
            run: { id: run.id, limit_usd: run.limit_usd, spent_usd: run.spent_usd },
          },
          201,
        );
      } finally {
        sending.delete(workspace); // recorded by now (or failed), so the waiting check covers it
      }
    },
  );

  app.get("/api/batches/:id", async (c) => {
    const batch = batchParam(c);
    try {
      return c.json(batchView(await batchApi().batchStatus(batch.id), batch.items.length));
    } catch (err) {
      if (err instanceof Refusal) throw err;
      return providerFailed(c, err);
    }
  });

  app.post("/api/batches/:id/cancel", async (c) => {
    const batch = batchParam(c);
    try {
      return c.json(batchView(await batchApi().cancelBatch(batch.id), batch.items.length));
    } catch (err) {
      if (err instanceof Refusal) throw err;
      return providerFailed(c, err);
    }
  });

  // Each result as a single reading's, priced at the batch rate. A request with
  // no result (errored, cancelled, expired or missing) says why, and costs nothing.
  // The first collection settles the run's reservation and logs each call; a
  // later one (after a reload) returns the same results without counting them again.
  app.get("/api/batches/:id/results", async (c) => {
    const batch = batchParam(c);
    const provider = batchApi();
    // One window at a time processes the results (it writes the readings and call records); taken before any await.
    deps.batches.claim(batch.id, now());
    let results;
    try {
      const status = await provider.batchStatus(batch.id);
      if (status.status !== "ended") throw new Refusal("batch", "the batch hasn't finished yet; check again later");
      results = await provider.batchResults(batch.id);
    } catch (err) {
      deps.batches.release(batch.id);
      if (err instanceof Refusal) throw err;
      return providerFailed(c, err);
    }
    const byId = new Map(results.map((r) => [r.custom_id, r]));
    const items = batch.items.map((item) => {
      const found = byId.get(item.custom_id);
      if (!found) return { custom_id: item.custom_id, request_sha256: item.request_sha256, failed: "missing", message: "the provider returned no result for this request", cost_usd: 0 };
      if ("failed" in found) return { custom_id: item.custom_id, request_sha256: item.request_sha256, failed: found.failed, message: found.message, cost_usd: 0 };
      const result: ProviderResult = redact(found.result, deps.secrets);
      return { custom_id: item.custom_id, ...result, provider: provider.name, request_sha256: item.request_sha256, cost_usd: cost(item.model, result.usage, true) };
    });
    // From here to markCollected nothing awaits, so two collections at once can't both settle and log the batch:
    // the second finds it collected. Each result is logged only if it isn't already, so a crash before
    // markCollected doesn't log it twice (the run, held in memory, is gone after a crash, so it can't be settled twice).
    if (!deps.batches.get(batch.id).collected_at) {
      const time = now();
      const logged = new Set(
        deps.egress
          .entries()
          .filter((e) => e.batch_id === batch.id && e.outcome !== "batch_submitted")
          .map((e) => e.request_sha256),
      );
      const run = deps.runs.find(batch.run_id); // gone if the proxy has restarted: the batch's spend was bounded when it was sent
      if (run) deps.runs.settle(run, batch.items.reduce((n, i) => n + i.worst_usd, 0), items.reduce((n, r) => n + r.cost_usd, 0));
      batch.items.forEach((item, i) => {
        const r = items[i];
        if (logged.has(item.request_sha256)) return;
        deps.egress.record({
          time: time.toISOString(),
          run_id: batch.run_id,
          model: item.model,
          prompt_version: item.prompt_version,
          request_sha256: item.request_sha256,
          outcome: "outcome" in r ? r.outcome : `batch_${r.failed}`,
          refusal: null,
          usage: "usage" in r ? r.usage : null,
          cost_usd: r.cost_usd,
          batch_id: batch.id,
        });
      });
      deps.batches.markCollected(batch.id, time);
    }
    return c.json({ id: batch.id, items });
  });

  app.post("/api/workspaces", async (c) => {
    const { action, path, ...retention } = await body(c, WorkspaceAction);
    if (action === "register" && Object.keys(retention).length) {
      throw new Refusal("boundary", "retention is set when a workspace is created; a registered workspace keeps its own");
    }
    const registration =
      action === "create" ? deps.workspaces.create(path, now(), retention) : deps.workspaces.register(path, now());
    return c.json({ registration_id: registration.id, path: registration.path }, 201);
  });

  app.post("/api/workspaces/confirm", async (c) => {
    const { registration_id, challenge } = await body(c, Confirm);
    return c.json(deps.workspaces.confirm(registration_id, { challenge, now: now() }));
  });

  app.post("/api/workspaces/forget", async (c) => {
    const { registration_id } = await body(c, Forget);
    return c.json({ forgotten: deps.workspaces.forget(registration_id) });
  });

  app.all("/api/*", (c) => c.json({ error: { type: "not_found", message: "no such endpoint" } }, 404));
  app.get("*", serveApp(deps.appDir));
  return app;
}
