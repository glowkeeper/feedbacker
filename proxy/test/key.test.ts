/** The API key is read only from the environment or the private .env, and never leaves the proxy. */

import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test } from "vitest";
import { ConfigError, loadApiKey } from "../src/config.ts";
import { AnthropicProvider } from "../src/provider.ts";
import { makeProxy, readRequest, submission, tempDir } from "./helpers.ts";

const KEY = "sk-ant-test-THIS-KEY-MUST-NEVER-APPEAR-0123456789";

describe("loading the key", () => {
  const envFile = (content: string, mode = 0o600) => {
    const path = join(tempDir(), ".env");
    writeFileSync(path, content);
    chmodSync(path, mode);
    return path;
  };

  test("prefers the environment", () => {
    expect(loadApiKey({ ANTHROPIC_API_KEY: ` ${KEY} `, FEEDBACKER_ENV: envFile("ANTHROPIC_API_KEY=other") })).toBe(KEY);
  });

  test("reads the private .env, with or without quotes", () => {
    expect(loadApiKey({ FEEDBACKER_ENV: envFile(`# comment\nOTHER=1\nANTHROPIC_API_KEY="${KEY}"\n`) })).toBe(KEY);
    expect(loadApiKey({ FEEDBACKER_ENV: envFile(`ANTHROPIC_API_KEY = ${KEY}`) })).toBe(KEY);
  });

  test("refuses a .env that other users can read", () => {
    expect(() => loadApiKey({ FEEDBACKER_ENV: envFile(`ANTHROPIC_API_KEY=${KEY}`, 0o644) })).toThrow(ConfigError);
  });

  test("is absent when there is no key anywhere", () => {
    expect(loadApiKey({ FEEDBACKER_ENV: join(tempDir(), "missing.env") })).toBeNull();
  });

  test("without a key, model requests are refused but the proxy still runs", async () => {
    const { call, openRun } = makeProxy({ provider: null });
    expect(await (await call("/api/health")).json()).toMatchObject({ key_configured: false });
    const res = await call(`/api/runs/${await openRun()}/read`, { body: readRequest() });
    expect(res.status).toBe(503);
    expect((await res.json()).error.type).toBe("key");
  });
});

/** The real SDK client, talking to a fake API that records what it is sent. */
function fakeApi(respond: (body: any) => Response) {
  const sent: { headers: Headers; body: any }[] = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push({ headers: new Headers(init?.headers), body });
    return respond(body);
  };
  const client = new Anthropic({ apiKey: KEY, fetch: fetch as typeof globalThis.fetch, maxRetries: 0 });
  return { provider: new AnthropicProvider(KEY, client), sent };
}

const message = (overrides: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content: [{ type: "text", text: '{"criteria":[]}' }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json", "request-id": "req_abc" } },
  );

describe("the Anthropic adapter", () => {
  test("sends the instructions, the blocks as one user turn, and the output schema", async () => {
    const { provider, sent } = fakeApi(() => message());
    const { call, openRun } = makeProxy({ provider });
    const res = await call(`/api/runs/${await openRun()}/read`, { body: readRequest() });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ outcome: "complete", parsed: { criteria: [] }, request_id: "req_abc", model_reported: "claude-sonnet-5" });
    expect(json.usage).toEqual({ input_tokens: 1200, output_tokens: 300, cache_read_tokens: 0, cache_write_tokens: 0 });
    const [{ body, headers }] = sent;
    expect(body).toMatchObject({
      model: "claude-sonnet-5",
      max_tokens: 16000,
      system: "Read the submission against the rubric.",
      output_config: { format: { type: "json_schema", schema: readRequest().output_schema } },
    });
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content.map((b: any) => b.text.split("\n")[0])).toEqual([
      "RUBRIC",
      "ASSESSMENT BRIEF",
      "SUBMISSION [STUDENT_A]",
    ]);
    expect(headers.get("x-api-key")).toBe(KEY); // the key goes to the provider, and only there
  });

  test.each([
    ["refused", { stop_reason: "refusal" }],
    ["truncated", { stop_reason: "max_tokens" }],
    ["unparsed", { content: [{ type: "text", text: "not json" }] }],
  ])("reports %s outcomes", async (outcome, overrides) => {
    const { provider } = fakeApi(() => message(overrides));
    const { call, openRun } = makeProxy({ provider });
    const json = await (await call(`/api/runs/${await openRun()}/read`, { body: readRequest() })).json();
    expect(json).toMatchObject({ outcome, parsed: null });
  });
});

test("the key never appears in any response, log, or error, even when the provider echoes it", async () => {
  const echo = (status: number) => () =>
    new Response(JSON.stringify({ type: "error", error: { type: "error", message: `bad key ${KEY}` } }), {
      status,
      headers: { "content-type": "application/json" },
    });
  const seen: string[] = [];
  for (const respond of [() => message(), echo(401), echo(403), echo(404), echo(429), echo(500)]) {
    const { provider } = fakeApi(respond);
    const { call, openRun, egressText } = makeProxy({ provider });
    const run = await openRun();
    const { blocks } = readRequest();
    for (const res of [
      await call("/api/health"),
      await call(`/api/runs/${run}`),
      await call(`/api/runs/${run}/read`, { body: readRequest() }),
      await call(`/api/runs/${run}/read`, { body: readRequest({ blocks: [blocks[0], submission("mail a@b.example.com")] }) }),
      await call(`/api/runs/${run}/read`, { body: { not: "valid" } }),
      await call("/"),
    ]) {
      seen.push(JSON.stringify([...res.headers]), await res.text());
    }
    seen.push(egressText());
  }
  const everything = seen.join("\n");
  expect(everything).toContain("the API key was rejected"); // the 401 and 403 were reported...
  expect(everything).not.toContain(KEY); // ...without the key
  expect(everything).not.toContain("sk-ant");
});
