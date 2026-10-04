/** Prompt caching: the shared prefix (instructions, rubric, brief) is marked for the provider's cache, and nothing else changes. */

import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test } from "vitest";
import { cost, PRICES, worstCase } from "../src/pricing.ts";
import { AnthropicProvider } from "../src/provider.ts";
import { makeProxy, readRequest, submission } from "./helpers.ts";

const KEY = "sk-ant-test-caching";

/** The real SDK client, talking to a fake API that records what it is sent. */
function fakeApi() {
  const sent: any[] = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [{ type: "text", text: '{"criteria":[]}' }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
      }),
      { status: 200, headers: { "content-type": "application/json", "request-id": "req_1" } },
    );
  };
  const client = new Anthropic({ apiKey: KEY, fetch: fetch as typeof globalThis.fetch, maxRetries: 0 });
  return { provider: new AnthropicProvider(KEY, client), sent };
}

describe("the shared prefix is cached", () => {
  test("the cache breakpoint is on the last shared block (the brief), and on nothing else", async () => {
    const { provider, sent } = fakeApi();
    const { call, openRun } = makeProxy({ provider });
    expect((await call(`/api/runs/${await openRun()}/read`, { body: readRequest() })).status).toBe(200);
    const content = sent[0].messages[0].content;
    expect(content.map((b: any) => b.cache_control ?? null)).toEqual([null, { type: "ephemeral" }, null]);
    expect(content[1].text.split("\n")[0]).toBe("ASSESSMENT BRIEF");
  });

  test("the prefix is identical for every submission of a run; only the submission differs", async () => {
    const { provider, sent } = fakeApi();
    const { call, openRun } = makeProxy({ provider });
    const run = await openRun();
    const { blocks } = readRequest();
    await call(`/api/runs/${run}/read`, { body: readRequest() });
    await call(`/api/runs/${run}/read`, { body: readRequest({ blocks: [blocks[0], blocks[1], submission("A different submission, with other words in it.")] }) });
    const [a, b] = sent;
    expect(a.system).toBe(b.system);
    expect(a.messages[0].content.slice(0, 2)).toEqual(b.messages[0].content.slice(0, 2));
    expect(a.messages[0].content[2]).not.toEqual(b.messages[0].content[2]);
  });

  test("cache reads are billed at the cache price, and reported in the usage", async () => {
    const { provider } = fakeApi();
    const { call, openRun } = makeProxy({ provider });
    const json = await (await call(`/api/runs/${await openRun()}/read`, { body: readRequest() })).json();
    expect(json.usage).toMatchObject({ input_tokens: 100, cache_read_tokens: 900, cache_write_tokens: 0 });
    expect(json.cost_usd).toBeCloseTo(cost("claude-sonnet-5", json.usage), 10);
    expect(json.cost_usd).toBeLessThan(cost("claude-sonnet-5", { ...json.usage, input_tokens: 1000, cache_read_tokens: 0 }));
  });
});

describe("prices and the worst case", () => {
  test("health gives each model's cache prices, so the app can show what caching saves", async () => {
    const { call } = makeProxy();
    const { prices } = await (await call("/api/health")).json();
    expect(prices["claude-sonnet-5"]).toEqual({ input: 2, output: 10, cache_read: 0.1, cache_write: 1.25, batch: 0.5 });
  });

  test("the worst case bills every input token as a cache write, the dearest way, so the limit holds", () => {
    const p = PRICES["claude-sonnet-5"];
    expect(worstCase("claude-sonnet-5", 3000, 100)).toBeCloseTo((1000 * p.input * 1.25 + 100 * p.output) / 1_000_000, 12);
  });
});
