/**
 * Batches (#25): every request is checked as a single reading is, the spend
 * is reserved at the batch price, only batches this proxy sent can be checked
 * or collected, and the first collection settles the run and logs each call.
 */

import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { MAX_BATCH, MAX_BATCH_BYTES } from "../src/app.ts";
import { Batches } from "../src/batches.ts";
import { renderBlock } from "../src/boundary.ts";
import { cost, worstCase } from "../src/pricing.ts";
import { AnthropicProvider, type BatchItemResult, type BatchStatus, type ProviderRequest } from "../src/provider.ts";
import { FakeProvider, makeProxy, readRequest, submission, tempDir } from "./helpers.ts";

const USAGE = { input_tokens: 1000, output_tokens: 500, cache_read_tokens: 0, cache_write_tokens: 0 };

/** A provider with a batch API, whose batch ends when told to. */
class FakeBatchProvider extends FakeProvider {
  batches: { id: string; items: { custom_id: string; request: ProviderRequest }[] }[] = [];
  ended = false;
  cancelled = false;
  results: ((custom_id: string, request: ProviderRequest) => BatchItemResult | null) | null = null;
  createError: Error | null = null;

  #status(id: string): BatchStatus {
    const n = this.batches.find((b) => b.id === id)!.items.length;
    return {
      id,
      status: this.ended ? "ended" : this.cancelled ? "canceling" : "in_progress",
      counts: { processing: this.ended ? 0 : n, succeeded: this.ended ? n : 0, errored: 0, canceled: 0, expired: 0 },
      created_at: "2026-01-15T09:00:00Z",
      expires_at: "2026-01-16T09:00:00Z",
      ended_at: this.ended ? "2026-01-15T10:00:00Z" : null,
    };
  }

  async createBatch(items: { custom_id: string; request: ProviderRequest }[]): Promise<BatchStatus> {
    if (this.createError) throw this.createError;
    const id = `msgbatch_${this.batches.length + 1}`;
    this.batches.push({ id, items });
    return this.#status(id);
  }

  async batchStatus(id: string) {
    return this.#status(id);
  }

  async cancelBatch(id: string) {
    this.cancelled = true;
    return this.#status(id);
  }

  async batchResults(id: string): Promise<BatchItemResult[]> {
    return this.batches
      .find((b) => b.id === id)!
      .items.flatMap(({ custom_id, request }) => {
        const custom = this.results?.(custom_id, request);
        if (custom !== undefined && custom !== null) return [custom];
        if (this.results && custom === null) return [];
        return [
          {
            custom_id,
            result: {
              outcome: "complete" as const,
              parsed: { criteria: [] },
              model_reported: request.model,
              request_id: `msg_${custom_id}`,
              stop_reason: "end_turn",
              usage: USAGE,
              raw_json: "{}",
            },
          },
        ];
      });
  }
}

const two = () => [readRequest(), readRequest({ blocks: [readRequest().blocks[0], readRequest().blocks[1], submission("Another approved submission.")] })];

async function sendBatch(options: { provider?: FakeProvider; limit?: number; requests?: unknown[] } = {}) {
  const provider = options.provider ?? new FakeBatchProvider();
  const proxy = makeProxy({ provider });
  const run = await proxy.openRun(options.limit ?? 5);
  const workspace = await proxy.newWorkspace();
  const res = await proxy.call(`/api/runs/${run}/batch`, { body: { workspace, requests: options.requests ?? two() } });
  return { ...proxy, provider: provider as FakeBatchProvider, run, workspace, res, json: await res.json() };
}

describe("sending a batch", () => {
  test("health says whether the provider has a batch API", async () => {
    expect((await (await makeProxy({ provider: new FakeBatchProvider() }).call("/api/health")).json()).batch).toBe(true);
    expect((await (await makeProxy({ provider: new FakeProvider() }).call("/api/health")).json()).batch).toBe(false);
  });

  test("the requests are sent together, each as a single reading would be, with the prefix marked for caching", async () => {
    const { res, json, provider } = await sendBatch();
    expect(res.status).toBe(201);
    expect(json).toMatchObject({ id: "msgbatch_1", status: "in_progress", requests: 2, provider: "fake" });
    expect(json.items.map((i: any) => i.custom_id)).toEqual(["r1", "r2"]);
    expect(json.items[0].request_sha256).toMatch(/^[0-9a-f]{64}$/);
    const [a, b] = provider.batches[0].items.map((i) => i.request);
    expect([a.shared_blocks, a.blocks[0], a.blocks[1]]).toEqual([2, b.blocks[0], b.blocks[1]]);
    expect(a.blocks[2]).not.toBe(b.blocks[2]);
  });

  test("the hash of each request is the one a single reading of it would record", async () => {
    const { json } = await sendBatch();
    const single = makeProxy();
    const live = await (await single.call(`/api/runs/${await single.openRun()}/read`, { body: readRequest() })).json();
    expect(json.items[0].request_sha256).toBe(live.request_sha256);
  });

  test("the whole batch is refused, with nothing sent, if any one request is", async () => {
    const bad = readRequest({ blocks: [readRequest().blocks[0], readRequest().blocks[1], submission("Contact me at student@example.ac.uk.")] });
    const { res, json, provider, egress } = await sendBatch({ requests: [readRequest(), bad] });
    expect(res.status).toBe(422);
    expect(json.error.message).toMatch(/^request 2: /);
    expect(provider.batches).toEqual([]);
    expect(egress.entries().map((e) => e.outcome)).toEqual(["refused_by_proxy"]);
  });

  test("the spend reserved is every request's worst case at the batch price, and a batch over the limit is refused", async () => {
    const { run, call } = await sendBatch();
    const reserved = (await (await call(`/api/runs/${run}`)).json()).reserved_usd;
    // Each request as a single reading would reserve it: every character sent, at the standard price.
    const single = (r: ReturnType<typeof readRequest>) => {
      const chars = [r.prompt.instructions, ...r.blocks.map((b: any) => renderBlock(b)), JSON.stringify(r.output_schema)].reduce((n, t) => n + [...t].length, 0);
      return worstCase(r.model, chars, r.max_output_tokens);
    };
    expect(reserved).toBeCloseTo(two().reduce((n, r) => n + single(r), 0) / 2, 12);
    const over = await sendBatch({ limit: reserved * 0.99 });
    expect([over.res.status, over.json.error.type]).toEqual([409, "spend"]);
    expect(over.provider.batches).toEqual([]);
  });

  test("without a batch API the provider is refused, and the app reads one at a time", async () => {
    const { res, json } = await sendBatch({ provider: new FakeProvider() });
    expect([res.status, json.error.type]).toEqual([409, "batch"]);
  });

  test("a failed send frees the reservation and gives the hashes of what was forwarded", async () => {
    const provider = new FakeBatchProvider();
    provider.createError = new Error("boom");
    const { res, json, run, call, egress } = await sendBatch({ provider });
    expect(res.status).toBe(502);
    expect(json.error.request_sha256s).toHaveLength(2);
    expect((await (await call(`/api/runs/${run}`)).json()).reserved_usd).toBe(0);
    expect(egress.entries().map((e) => e.outcome)).toEqual(["provider_error", "provider_error"]);
  });

  test("the egress log records each request sent, with its batch, and none of its text", async () => {
    const { egress, egressText } = await sendBatch();
    expect(egress.entries().map((e) => [e.outcome, e.batch_id, e.cost_usd])).toEqual([
      ["batch_submitted", "msgbatch_1", null],
      ["batch_submitted", "msgbatch_1", null],
    ]);
    expect(egressText()).not.toContain("STUDENT_A");
  });

  test("the proxy keeps a private record of the batch, with no text", async () => {
    const { data } = await sendBatch();
    const path = join(data, "batches.json");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const text = readFileSync(path, "utf8");
    expect(JSON.parse(text).batches[0]).toMatchObject({ id: "msgbatch_1", collected_at: null });
    expect(text).not.toMatch(/STUDENT_A|planner|submission/i);
  });
});

describe("the limits and failures of sending", () => {
  test("more than MAX_BATCH requests, or a body over MAX_BATCH_BYTES, is refused before anything is sent", async () => {
    const many = await sendBatch({ requests: Array.from({ length: MAX_BATCH + 1 }, () => readRequest()) });
    expect([many.res.status, many.json.error.type]).toEqual([422, "boundary"]);
    const provider = new FakeBatchProvider();
    const proxy = makeProxy({ provider });
    const run = await proxy.openRun();
    const res = await proxy.call(`/api/runs/${run}/batch`, { body: { workspace: await proxy.newWorkspace(), requests: [readRequest()], padding: "x".repeat(MAX_BATCH_BYTES) } });
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/larger than 32 MB/);
    expect([many.provider.batches, provider.batches]).toEqual([[], []]);
  });

  test("an unusable batch record stops the batch before anything is sent, and frees the reservation", async () => {
    const data = tempDir();
    mkdirSync(join(data, "batches.json")); // unreadable as a record
    const provider = new FakeBatchProvider();
    const proxy = makeProxy({ provider, data });
    const run = await proxy.openRun();
    const res = await proxy.call(`/api/runs/${run}/batch`, { body: { workspace: await proxy.newWorkspace(), requests: two() } });
    expect(res.status).toBe(500);
    expect((await res.json()).error.message).toMatch(/^nothing was sent/);
    expect(provider.batches).toEqual([]);
    expect((await (await proxy.call(`/api/runs/${run}`)).json()).reserved_usd).toBe(0);
  });

  test("a batch sent but not recorded is cancelled, its reservation held, and its ID logged", async () => {
    const data = tempDir();
    const batches = new Batches(join(data, "batches.json"));
    batches.add = () => {
      throw new Error("disk full");
    };
    const provider = new FakeBatchProvider();
    const proxy = makeProxy({ provider, data, batches });
    const run = await proxy.openRun();
    const res = await proxy.call(`/api/runs/${run}/batch`, { body: { workspace: await proxy.newWorkspace(), requests: two() } });
    expect(res.status).toBe(500);
    expect((await res.json()).error.message).toMatch(/cancelled \(msgbatch_1\)/);
    expect(provider.cancelled).toBe(true);
    expect((await (await proxy.call(`/api/runs/${run}`)).json()).reserved_usd).toBeGreaterThan(0);
    expect(proxy.egress.entries().map((e) => [e.outcome, e.batch_id])).toEqual([
      ["batch_cancelled_unrecorded", "msgbatch_1"],
      ["batch_cancelled_unrecorded", "msgbatch_1"],
    ]);
  });

  test("the record is replaced whole, leaving no temporary file", async () => {
    const { data } = await sendBatch();
    expect(readdirSync(data).sort()).toEqual(["batches.json", "egress.jsonl", "registry.json"].filter((f) => existsSync(join(data, f))));
  });

  test("a provider with only part of the batch API is not offered as batch-capable", async () => {
    const partial = new FakeProvider() as FakeProvider & { createBatch?: unknown };
    partial.createBatch = async () => {
      throw new Error("unused");
    };
    const proxy = makeProxy({ provider: partial as FakeProvider });
    expect((await (await proxy.call("/api/health")).json()).batch).toBe(false);
    const res = await proxy.call(`/api/runs/${await proxy.openRun()}/batch`, { body: { workspace: await proxy.newWorkspace(), requests: [readRequest()] } });
    expect((await res.json()).error.type).toBe("batch");
  });
});

describe("one batch waiting per workspace", () => {
  const post = (proxy: ReturnType<typeof makeProxy>, run: string, workspace: string) =>
    proxy.call(`/api/runs/${run}/batch`, { body: { workspace, requests: [readRequest()] } });

  test("a second batch for the same workspace is refused while the first waits; another workspace's isn't", async () => {
    const { call, run, workspace, newWorkspace, provider } = await sendBatch();
    const again = await post({ call } as any, run, workspace);
    expect([again.status, (await again.json()).error.message]).toEqual([409, expect.stringMatching(/still waiting \(msgbatch_1\)/)]);
    expect((await post({ call } as any, run, await newWorkspace())).status).toBe(201);
    expect(provider.batches).toHaveLength(2);
  });

  test("two windows sending at once: one batch is sent, the other refused", async () => {
    const provider = new FakeBatchProvider();
    const proxy = makeProxy({ provider });
    const run = await proxy.openRun();
    const workspace = await proxy.newWorkspace();
    const statuses = (await Promise.all([post(proxy, run, workspace), post(proxy, run, workspace)])).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(provider.batches).toHaveLength(1);
  });

  test("once its results are collected, or a day has passed, the workspace can send another", async () => {
    const { call, run, workspace, provider, data } = await sendBatch();
    provider.ended = true;
    await call("/api/batches/msgbatch_1/results");
    expect((await post({ call } as any, run, workspace)).status).toBe(201);
    // An uncollected batch older than a day (it has ended) no longer holds the place.
    const later = makeProxy({ provider, data, now: () => new Date("2026-01-16T10:01:00Z") });
    const laterRun = await later.openRun();
    expect((await post(later, laterRun, workspace)).status).toBe(201);
  });

  test("a batch must name a workspace registered with this proxy", async () => {
    const proxy = makeProxy({ provider: new FakeBatchProvider() });
    const res = await post(proxy, await proxy.openRun(), "ws-unknown");
    expect([res.status, (await res.json()).error.message]).toEqual([409, expect.stringMatching(/no such workspace/)]);
  });
});

describe("checking and collecting", () => {
  test("its status, until it ends", async () => {
    const { call, provider } = await sendBatch();
    expect((await (await call("/api/batches/msgbatch_1")).json()).status).toBe("in_progress");
    provider.ended = true;
    expect(await (await call("/api/batches/msgbatch_1")).json()).toMatchObject({ status: "ended", requests: 2, counts: { succeeded: 2 } });
  });

  test("results are refused until the batch has ended", async () => {
    const { call } = await sendBatch();
    const res = await call("/api/batches/msgbatch_1/results");
    expect([res.status, (await res.json()).error.type]).toEqual([409, "batch"]);
  });

  test("only a batch this proxy sent can be checked, collected or cancelled", async () => {
    const { call } = await sendBatch();
    for (const [path, method] of [["/api/batches/msgbatch_other", "GET"], ["/api/batches/msgbatch_other/results", "GET"], ["/api/batches/msgbatch_other/cancel", "POST"], ["/api/batches/..%2Fx", "GET"]]) {
      const res = await call(path, { method, body: method === "POST" ? {} : undefined });
      expect([path, res.status]).toEqual([path, 409]);
    }
  });

  test("each result as a single reading's, at the batch price, with its request hash", async () => {
    const { call, provider, json: sent } = await sendBatch();
    provider.ended = true;
    const { items } = await (await call("/api/batches/msgbatch_1/results")).json();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ custom_id: "r1", outcome: "complete", provider: "fake", request_id: "msg_r1", request_sha256: sent.items[0].request_sha256 });
    expect(items[0].cost_usd).toBeCloseTo(cost("claude-sonnet-5", USAGE) / 2, 12);
  });

  test("a request with no result says why, and costs nothing", async () => {
    const provider = new FakeBatchProvider();
    provider.results = (id) => (id === "r1" ? { custom_id: id, failed: "expired", message: "the batch expired before this request was processed" } : null);
    const { call } = await sendBatch({ provider });
    provider.ended = true;
    const { items } = await (await call("/api/batches/msgbatch_1/results")).json();
    expect(items.map((i: any) => [i.failed, i.cost_usd])).toEqual([["expired", 0], ["missing", 0]]);
  });

  test("the first collection settles the run and logs each call; a later one counts nothing again", async () => {
    const { call, provider, run, egress, data } = await sendBatch();
    provider.ended = true;
    await call("/api/batches/msgbatch_1/results");
    const after = await (await call(`/api/runs/${run}`)).json();
    expect(after.reserved_usd).toBeCloseTo(0, 12);
    expect(after.spent_usd).toBeCloseTo(cost("claude-sonnet-5", USAGE), 12); // two at half price
    const later = makeProxy({ provider, data, now: () => new Date("2026-01-15T09:11:00Z") }); // once the lease has run out
    const again = await (await later.call("/api/batches/msgbatch_1/results")).json();
    expect(again.items).toHaveLength(2);
    expect((await (await call(`/api/runs/${run}`)).json()).spent_usd).toBe(after.spent_usd);
    expect(egress.entries().map((e) => e.outcome)).toEqual(["batch_submitted", "batch_submitted", "complete", "complete"]);
  });

  test("while one window collects the results, another is refused, until the lease runs out", async () => {
    const { call, provider, data } = await sendBatch();
    provider.ended = true;
    expect((await call("/api/batches/msgbatch_1/results")).status).toBe(200);
    const second = await call("/api/batches/msgbatch_1/results");
    expect([second.status, (await second.json()).error.message]).toEqual([409, expect.stringMatching(/another window/)]);
    const later = makeProxy({ provider, data, now: () => new Date("2026-01-15T09:11:00Z") });
    expect((await later.call("/api/batches/msgbatch_1/results")).status).toBe(200);
  });

  test("a collection that fails gives up its lease at once", async () => {
    const { call, provider, data } = await sendBatch();
    expect((await call("/api/batches/msgbatch_1/results")).status).toBe(409); // not finished yet
    expect(new Batches(join(data, "batches.json")).get("msgbatch_1").collecting_until).toBeNull();
    provider.ended = true;
    expect((await call("/api/batches/msgbatch_1/results")).status).toBe(200);
  });

  test("results can still be collected after the proxy restarts, when its run is gone", async () => {
    const { provider, data } = await sendBatch();
    provider.ended = true;
    const restarted = makeProxy({ provider, data }); // the same data folder, as after a restart
    const res = await restarted.call("/api/batches/msgbatch_1/results");
    expect(res.status).toBe(200);
    expect(restarted.egress.entries().filter((e) => e.outcome === "complete")).toHaveLength(2);
  });

  test("two collections at once settle and log the batch once", async () => {
    const { call, provider, run, egress } = await sendBatch();
    provider.ended = true;
    await Promise.all([call("/api/batches/msgbatch_1/results"), call("/api/batches/msgbatch_1/results")]);
    expect((await (await call(`/api/runs/${run}`)).json()).spent_usd).toBeCloseTo(cost("claude-sonnet-5", USAGE), 12);
    expect(egress.entries().filter((e) => e.outcome === "complete")).toHaveLength(2);
  });

  test("a crash after logging but before the batch was marked collected doesn't log its results twice", async () => {
    const { call, provider, data, egress } = await sendBatch();
    provider.ended = true;
    await call("/api/batches/msgbatch_1/results");
    const record = new Batches(join(data, "batches.json"));
    record.add({ ...record.get("msgbatch_1"), collected_at: null }); // as if the proxy stopped before marking it
    const restarted = makeProxy({ provider, data, now: () => new Date("2026-01-15T09:11:00Z") }); // restarted once the lease has run out
    expect((await restarted.call("/api/batches/msgbatch_1/results")).status).toBe(200);
    expect(egress.entries().filter((e) => e.outcome === "complete")).toHaveLength(2);
    expect(record.get("msgbatch_1").collected_at).not.toBeNull();
  });

  test("a result is redacted of the key", async () => {
    const provider = new FakeBatchProvider();
    provider.results = (id, request) => ({
      custom_id: id,
      result: { outcome: "complete", parsed: { criteria: [], note: "sk-secret" }, model_reported: request.model, request_id: null, stop_reason: "end_turn", usage: USAGE, raw_json: '"sk-secret"' },
    });
    const proxy = makeProxy({ provider, secrets: ["sk-secret"] });
    await proxy.call(`/api/runs/${await proxy.openRun()}/batch`, { body: { workspace: await proxy.newWorkspace(), requests: [readRequest()] } });
    provider.ended = true;
    const text = await (await proxy.call("/api/batches/msgbatch_1/results")).text();
    expect(text).not.toContain("sk-secret");
    expect(text).toContain("[REDACTED]");
  });

  test("a batch can be cancelled", async () => {
    const { call } = await sendBatch();
    expect((await (await call("/api/batches/msgbatch_1/cancel", { body: {} })).json()).status).toBe("canceling");
  });

  test("the record forgets batches whose results the provider no longer keeps", () => {
    const batches = new Batches(join(tempDir(), "batches.json"));
    batches.add({ id: "msgbatch_old", run_id: "run-1", workspace: "ws-1", created_at: "2026-01-01T00:00:00Z", items: [], collected_at: null });
    batches.add({ id: "msgbatch_new", run_id: "run-1", workspace: "ws-1", created_at: "2026-02-01T00:00:00Z", items: [], collected_at: null });
    expect(batches.prune(new Date("2026-02-05T00:00:00Z"))).toBe(1);
    expect(() => batches.get("msgbatch_old")).toThrow(/no such batch/);
    expect(batches.get("msgbatch_new").id).toBe("msgbatch_new");
  });
});

describe("the Anthropic adapter's batch calls", () => {
  const KEY = "sk-ant-test-batch";
  const message = (custom_id: string) => ({
    custom_id,
    result: {
      type: "succeeded",
      message: {
        id: `msg_${custom_id}`,
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [{ type: "text", text: '{"criteria":[]}' }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
      },
    },
  });
  const batch = (status: string) => ({
    id: "msgbatch_1",
    type: "message_batch",
    processing_status: status,
    request_counts: { processing: status === "ended" ? 0 : 3, succeeded: status === "ended" ? 1 : 0, errored: status === "ended" ? 1 : 0, canceled: 0, expired: status === "ended" ? 1 : 0 },
    created_at: "2026-01-15T09:00:00Z",
    expires_at: "2026-01-16T09:00:00Z",
    ended_at: status === "ended" ? "2026-01-15T10:00:00Z" : null,
    archived_at: null,
    cancel_initiated_at: null,
    results_url: status === "ended" ? "https://api.anthropic.com/v1/messages/batches/msgbatch_1/results" : null,
  });

  function fakeApi() {
    const sent: { method: string; url: string; body: any }[] = [];
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      sent.push({ method: init?.method ?? "GET", url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
      const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
      if (u.endsWith("/results")) {
        const lines = [message("r1"), { custom_id: "r2", result: { type: "errored", error: { type: "error", error: { type: "invalid_request_error", message: "text that must not be passed on" } } } }, { custom_id: "r3", result: { type: "expired" } }];
        return new Response(lines.map((l) => JSON.stringify(l)).join("\n"), { status: 200, headers: { "content-type": "application/binary" } });
      }
      if (u.endsWith("/cancel")) return json(batch("canceling"));
      if (init?.method === "POST") return json(batch("in_progress"));
      return json(batch("ended"));
    };
    const client = new Anthropic({ apiKey: KEY, fetch: fetch as typeof globalThis.fetch, maxRetries: 0 });
    return { provider: new AnthropicProvider(KEY, client), sent };
  }

  const request = (text: string): ProviderRequest => ({
    model: "claude-sonnet-5",
    max_output_tokens: 1000,
    instructions: "Read it.",
    blocks: ["RUBRIC\n\nr", "ASSESSMENT BRIEF\n\nb", `SUBMISSION\n\n${text}`],
    shared_blocks: 2,
    output_schema: { type: "object" },
  });

  test("each request is sent as a single reading would be, with its custom id", async () => {
    const { provider, sent } = fakeApi();
    const status = await provider.createBatch([{ custom_id: "r1", request: request("one") }, { custom_id: "r2", request: request("two") }]);
    expect(status).toMatchObject({ id: "msgbatch_1", status: "in_progress", counts: { processing: 3 } });
    const body = sent[0].body;
    expect(sent[0].url).toMatch(/\/v1\/messages\/batches$/);
    expect(body.requests.map((r: any) => r.custom_id)).toEqual(["r1", "r2"]);
    const params = body.requests[0].params;
    expect(params).toMatchObject({ model: "claude-sonnet-5", max_tokens: 1000, system: "Read it.", output_config: { format: { type: "json_schema" } } });
    expect(params.messages[0].content.map((b: any) => b.cache_control ?? null)).toEqual([null, { type: "ephemeral" }, null]);
  });

  test("results: a reading with its usage and message id, and the others with Feedbacker's own reasons", async () => {
    const { provider } = fakeApi();
    const results = await provider.batchResults("msgbatch_1");
    expect(results[0]).toMatchObject({ custom_id: "r1", result: { outcome: "complete", request_id: "msg_r1", usage: { cache_read_tokens: 900 } } });
    expect(results.slice(1)).toEqual([
      { custom_id: "r2", failed: "errored", message: "the provider could not process this request (invalid_request_error)" },
      { custom_id: "r3", failed: "expired", message: "the batch expired before this request was processed" },
    ]);
    expect(JSON.stringify(results)).not.toContain("must not be passed on");
  });

  test("status and cancel", async () => {
    const { provider } = fakeApi();
    expect((await provider.batchStatus("msgbatch_1")).status).toBe("ended");
    expect((await provider.cancelBatch("msgbatch_1")).status).toBe("canceling");
  });
});

test("nothing is written to the batch record by a single reading", async () => {
  const proxy = makeProxy({ provider: new FakeBatchProvider() });
  await proxy.call(`/api/runs/${await proxy.openRun()}/read`, { body: readRequest() });
  expect(existsSync(join(proxy.data, "batches.json"))).toBe(false);
});
