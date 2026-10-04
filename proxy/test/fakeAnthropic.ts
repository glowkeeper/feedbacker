/**
 * The real Anthropic SDK client and adapter, talking to a scripted fake API
 * over HTTP: for tests of the reading end to end (core → proxy → adapter →
 * SDK), as the Python tests fake the SDK client. Nothing contacts the API.
 */

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "../src/provider.ts";

/** A scripted reply: a message, or an HTTP error status (401 becomes the SDK's AuthenticationError, and so on). */
export type Reply = { message: Record<string, unknown>; requestId?: string } | { status: number };

/**
 * The fake's batch API: a batch ends when `ended` is set, and its
 * results are the scripted replies to its requests, in order, taken when the
 * results are first fetched. `outcomes` makes a request expire, be cancelled
 * or error instead ("r1": "expired").
 */
export interface FakeBatches {
  created: { id: string; requests: { custom_id: string; params: any }[] }[];
  ended: boolean;
  cancelled: string[];
  outcomes: Record<string, "expired" | "canceled" | "errored">;
  /** HTTP status for creating a batch, to script a failure. */
  createStatus: number | null;
}

export function fakeAnthropic(replies: ((body: any) => Reply)[], apiKey = "sk-ant-test-fake") {
  const sent: any[] = [];
  const batches: FakeBatches = { created: [], ended: false, cancelled: [], outcomes: {}, createStatus: null };
  const results = new Map<string, string>();
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const batch = (id: string) => {
    const n = batches.created.find((b) => b.id === id)!.requests.length;
    const ended = batches.ended || batches.cancelled.includes(id);
    return {
      id,
      type: "message_batch",
      processing_status: ended ? "ended" : "in_progress",
      request_counts: { processing: ended ? 0 : n, succeeded: ended ? n : 0, errored: 0, canceled: 0, expired: 0 },
      created_at: "2026-01-15T09:00:00Z",
      expires_at: "2026-01-16T09:00:00Z",
      ended_at: ended ? "2026-01-15T10:00:00Z" : null,
      archived_at: null,
      cancel_initiated_at: null,
      results_url: ended ? `https://api.anthropic.com/v1/messages/batches/${id}/results` : null,
    };
  };
  const batchApi = (url: string, init?: RequestInit): Response => {
    const [, id, action] = url.match(/\/v1\/messages\/batches(?:\/([^/?]+))?(?:\/(results|cancel))?/)!;
    if (!id) {
      if (batches.createStatus) return json({ type: "error", error: { type: "error", message: "scripted" } }, batches.createStatus);
      const requests = JSON.parse(String(init?.body)).requests;
      const made = { id: `msgbatch_${batches.created.length + 1}`, requests };
      batches.created.push(made);
      for (const r of requests) sent.push(r.params);
      return json(batch(made.id));
    }
    if (action === "cancel") {
      batches.cancelled.push(id);
      return json(batch(id));
    }
    if (action === "results") {
      if (!results.has(id)) {
        const lines = batches.created.find((b) => b.id === id)!.requests.map(({ custom_id, params }) => {
          const outcome = batches.outcomes[custom_id];
          if (outcome === "errored") return { custom_id, result: { type: "errored", error: { type: "error", error: { type: "api_error", message: "scripted" } } } };
          if (outcome) return { custom_id, result: { type: outcome } };
          const reply = replies.shift()?.(params);
          if (!reply || "status" in reply) return { custom_id, result: { type: "errored", error: { type: "error", error: { type: "api_error", message: "scripted" } } } };
          return { custom_id, result: { type: "succeeded", message: { id: `msg_${custom_id}`, type: "message", role: "assistant", stop_sequence: null, ...reply.message } } };
        });
        results.set(id, lines.map((l) => JSON.stringify(l)).join("\n"));
      }
      return new Response(results.get(id), { status: 200, headers: { "content-type": "application/binary" } });
    }
    return json(batch(id));
  };
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/v1/messages/batches")) return batchApi(String(url), init);
    const body = JSON.parse(String(init?.body));
    sent.push(body);
    const next = replies.shift();
    if (!next) return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "no scripted reply" } }), { status: 500 });
    const reply = next(body);
    if ("status" in reply) {
      return new Response(JSON.stringify({ type: "error", error: { type: "error", message: "scripted" } }), {
        status: reply.status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", stop_sequence: null, ...reply.message }), {
      status: 200,
      headers: { "content-type": "application/json", "request-id": reply.requestId ?? "req_1" },
    });
  };
  const client = new Anthropic({ apiKey, fetch: fetch as typeof globalThis.fetch, maxRetries: 0 });
  return { provider: new AnthropicProvider(apiKey, client), sent, batches };
}
