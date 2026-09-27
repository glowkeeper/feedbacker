/**
 * The real Anthropic SDK client and adapter, talking to a scripted fake API
 * over HTTP: for tests of the reading end to end (core → proxy → adapter →
 * SDK), as the Python tests fake the SDK client. Nothing contacts the API.
 */

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "../src/provider.ts";

/** A scripted reply: a message, or an HTTP error status (401 becomes the SDK's AuthenticationError, and so on). */
export type Reply = { message: Record<string, unknown>; requestId?: string } | { status: number };

export function fakeAnthropic(replies: ((body: any) => Reply)[], apiKey = "sk-ant-test-fake") {
  const sent: any[] = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
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
  return { provider: new AnthropicProvider(apiKey, client), sent };
}
