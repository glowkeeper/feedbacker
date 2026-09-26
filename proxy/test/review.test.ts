/** Fixes from the review of #56, one test (or more) per finding. */

import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { EgressLog } from "../src/egress.ts";
import { worstCase } from "../src/pricing.ts";
import { FakeProvider, makeProxy, readRequest, tempDir } from "./helpers.ts";

const SECRET = "sk-ant-review-SECRET-0123456789";

describe("the egress log holds only trusted metadata", () => {
  test("a refused request logs no app-supplied model name or prompt version", async () => {
    const { call, openRun, egressText } = makeProxy();
    const run = await openRun();
    for (const body of [
      readRequest({ model: "Jordan Pike's model" }),
      readRequest({ prompt: { version: "sk-ant-looks-like-a-key", instructions: "x" }, model: "nope" }),
      { ...readRequest(), unexpected: true, model: "Jordan-Pike" },
    ]) {
      expect((await call(`/api/runs/${run}/read`, { body })).status).toBe(422);
    }
    const log = egressText();
    expect(log).not.toMatch(/Jordan|Pike|sk-ant/);
    expect(log.trim().split("\n")).toHaveLength(3);
  });

  test("a priced model is still logged on refusal", async () => {
    const { call, openRun, egress } = makeProxy();
    const run = await openRun(0.1, 0.05); // too small for the request's worst case
    await call(`/api/runs/${run}/read`, { body: readRequest() });
    const [entry] = egress.entries();
    expect(entry).toMatchObject({ model: "claude-sonnet-5", prompt_version: null, refusal: "spend" });
  });

  test("a prompt version is leak-checked like everything else sent", async () => {
    const { call, openRun } = makeProxy();
    const res = await call(`/api/runs/${await openRun()}/read`, {
      body: readRequest({ prompt: { version: "v-1234567", instructions: "x" } }),
    });
    expect((await res.json()).error.message).toContain("the prompt version contains a long number");
  });
});

describe("the configured key", () => {
  test("a request containing it anywhere is refused and never sent", async () => {
    const { call, openRun, provider, egressText } = makeProxy({ secrets: [SECRET] });
    const run = await openRun();
    for (const body of [
      readRequest({ prompt: { version: "v1", instructions: `use ${SECRET}` } }),
      readRequest({ output_schema: { title: SECRET } }),
    ]) {
      const res = await call(`/api/runs/${run}/read`, { body });
      expect(res.status).toBe(422);
      expect((await res.json()).error.message).toBe("not sent, because it contains the proxy's API key");
    }
    expect((provider as FakeProvider).calls).toHaveLength(0);
    expect(egressText()).not.toContain(SECRET);
  });

  test("is redacted from anything a provider returns", async () => {
    const provider = new FakeProvider();
    provider.result = { raw_json: `{"echo":"${SECRET}"}`, parsed: { note: `key ${SECRET}`, [SECRET]: [SECRET] }, request_id: SECRET };
    const { call, openRun } = makeProxy({ provider, secrets: [SECRET] });
    const text = await (await call(`/api/runs/${await openRun()}/read`, { body: readRequest() })).text();
    expect(text).not.toContain(SECRET);
    expect(text).toContain("[REDACTED]");
  });
});

test.each(["toString", "constructor", "__proto__", "hasOwnProperty"])(
  "an inherited property name (%s) is not a priced model",
  async (model) => {
    const { call, openRun, provider } = makeProxy();
    const run = await openRun();
    const res = await call(`/api/runs/${run}/read`, { body: readRequest({ model }) });
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toContain("no price is known");
    expect((provider as FakeProvider).calls).toHaveLength(0);
    expect((await (await call(`/api/runs/${run}`)).json()).spent_usd).toBe(0);
  },
);

test("the output schema counts towards a request's worst case", async () => {
  const schema = { type: "object", description: "x".repeat(30_000) };
  const request = readRequest({ output_schema: schema });
  const text = request.prompt.instructions + request.blocks.map((b: any) => `${b.heading}\n\n${b.text}`).join("");
  const without = worstCase("claude-sonnet-5", [...text].length, 16000);
  const withSchema = worstCase("claude-sonnet-5", [...text].length + JSON.stringify(schema).length, 16000);
  const { call, openRun } = makeProxy();
  const run = await openRun((without + withSchema) / 2, 0); // enough without the schema, not with it
  const res = await call(`/api/runs/${run}/read`, { body: request });
  expect(res.status).toBe(409);
  expect((await res.json()).error.type).toBe("spend");
});

describe("command-line numbers are validated", () => {
  const start = (...args: string[]) => {
    try {
      execFileSync("node", ["src/main.ts", "--data", tempDir(), ...args], {
        env: { PATH: process.env.PATH, FEEDBACKER_ENV: join(tempDir(), "none.env") },
        stdio: "pipe",
        timeout: 10_000,
      });
      return "started";
    } catch (err: any) {
      return `exit ${err.status}: ${err.stderr}`;
    }
  };

  test.each([
    [["--max-run-usd", "NaN"], "--max-run-usd must be a number"],
    [["--max-run-usd", "Infinity"], "--max-run-usd must be a number"],
    [["--max-run-usd", "0"], "--max-run-usd must be a number of at least 0.01"],
    [["--egress-retention-days", "0.5"], "--egress-retention-days must be a whole number"],
    [["--port", "70000"], "--port must be at most 65535"],
    [["--port", "abc"], "--port must be a whole number"],
  ])("refuses %j", (args, message) => {
    const result = start(...args);
    expect(result).toMatch(/^exit 1: /);
    expect(result).toContain(message);
  });
});

describe("creating a workspace", () => {
  test("writes the manifest the Python core requires", async () => {
    const { call } = makeProxy();
    const path = join(tempDir(), "moderation-2");
    const res = await call("/api/workspaces", { body: { action: "create", path, retention_days: 30, retention_source: "provider terms" } });
    const manifestPath = join((await res.json()).path, "workspace.json");
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual({
      layout_version: 1,
      name: "moderation-2",
      created_at: "2026-01-15T09:00:00.000Z",
      retention_days: 30,
      retention_source: "provider terms",
    });
    expect(statSync(manifestPath).mode & 0o777).toBe(0o644); // as the Python core writes it, inside a 700 folder
  });

  test("defaults the retention to 90 days, and refuses a bad one", async () => {
    const { call } = makeProxy();
    const ok = await (await call("/api/workspaces", { body: { action: "create", path: join(tempDir(), "ws") } })).json();
    expect(JSON.parse(readFileSync(join(ok.path, "workspace.json"), "utf8"))).toMatchObject({ retention_days: 90, retention_source: "default" });
    const bad = await call("/api/workspaces", { body: { action: "create", path: join(tempDir(), "ws"), retention_days: 0 } });
    expect(bad.status).toBe(422);
  });

  test("retention can't be changed by registering", async () => {
    const { call } = makeProxy();
    const res = await call("/api/workspaces", { body: { action: "register", path: tempDir(), retention_days: 5 } });
    expect((await res.json()).error.message).toContain("retention is set when a workspace is created");
  });
});

test("an existing egress log is locked down to 600 on start-up and when pruning", () => {
  const path = join(tempDir(), "egress.jsonl");
  writeFileSync(path, "", { mode: 0o644 });
  chmodSync(path, 0o644);
  const log = new EgressLog(path, 90);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  chmodSync(path, 0o644);
  expect(log.prune(new Date())).toBe(0);
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

test("a malformed URL is a 404, not a server error", async () => {
  const { call } = makeProxy({ appDir: tempDir() });
  expect((await call("/%")).status).toBe(404);
  expect((await call("/%E0%A4%A")).status).toBe(404);
});
