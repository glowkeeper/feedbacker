/** A proxy wired to temporary folders and a fake provider, and requests as the app sends them. */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { sha256Text } from "../src/boundary.ts";
import { EgressLog } from "../src/egress.ts";
import type { Provider, ProviderRequest, ProviderResult } from "../src/provider.ts";
import { Runs } from "../src/runs.ts";
import { Workspaces } from "../src/workspaces.ts";

export const PORT = 8765;
export const ORIGIN = `http://127.0.0.1:${PORT}`;
export const TOKEN = "test-session-token-0123456789abcdef";

/** Tests read JSON responses loosely; the proxy's own code never does. */
export type JsonResponse = Omit<Response, "json"> & { json(): Promise<any> };

export const tempDir = (prefix = "proxy-test-") => mkdtempSync(join(tmpdir(), prefix));

export class FakeProvider implements Provider {
  readonly name = "fake";
  readonly calls: ProviderRequest[] = [];
  result: Partial<ProviderResult> | Error = {};

  async read(request: ProviderRequest): Promise<ProviderResult> {
    this.calls.push(request);
    if (this.result instanceof Error) throw this.result;
    return {
      outcome: "complete",
      parsed: { criteria: [] },
      model_reported: request.model,
      request_id: "req_1",
      stop_reason: "end_turn",
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_tokens: 0, cache_write_tokens: 0 },
      raw_json: "{}",
      ...this.result,
    };
  }
}

export function makeProxy(
  options: { provider?: Provider | null; maxRunUsd?: number; appDir?: string | null; secrets?: string[] } = {},
) {
  const data = tempDir();
  const provider = options.provider === undefined ? new FakeProvider() : options.provider;
  const egress = new EgressLog(join(data, "egress.jsonl"), 90);
  const app = createApp({
    session: { token: TOKEN, port: PORT },
    provider,
    runs: new Runs(options.maxRunUsd ?? 5),
    egress,
    workspaces: new Workspaces(join(data, "registry.json")),
    appDir: options.appDir ?? null,
    secrets: options.secrets ?? [],
    now: () => new Date("2026-01-15T09:00:00Z"),
  });
  const call = (
    path: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<JsonResponse> =>
    app.request(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        host: `127.0.0.1:${PORT}`,
        origin: ORIGIN,
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }) as Promise<JsonResponse>;
  const openRun = async (limit_usd = 5, estimate_usd = 1) =>
    (await (await call("/api/runs", { body: { limit_usd, estimate_usd, confirmed: true } })).json()).id as string;
  const egressText = () => {
    try {
      return readFileSync(egress.path, "utf8");
    } catch {
      return "";
    }
  };
  return { app, call, openRun, egress, egressText, provider, data };
}

const SUBMISSION = "[STUDENT_A] built a planner with clear screens and informal testing.";
const BRIEF = "Build a study planner for [ORG_1] students.";

/** A request as the app would send it for one approved submission. */
export function readRequest(overrides: Record<string, unknown> = {}) {
  return {
    model: "claude-sonnet-5",
    max_output_tokens: 16000,
    prompt: { version: "reading-v1", instructions: "Read the submission against the rubric." },
    blocks: [
      { kind: "rubric", heading: "RUBRIC", text: "Criterion id: design\n- Level id: p68 | 2:1 (68)" },
      { kind: "brief", heading: "ASSESSMENT BRIEF", text: BRIEF, approved_sha256: sha256Text(BRIEF) },
      { kind: "submission", heading: "SUBMISSION [STUDENT_A]", text: SUBMISSION, approved_sha256: sha256Text(SUBMISSION) },
    ],
    output_schema: { type: "object", properties: { criteria: { type: "array" } }, required: ["criteria"] },
    ...overrides,
  };
}

/** A submission block whose text is approved as given. */
export const submission = (text: string) => ({
  kind: "submission",
  heading: "SUBMISSION [STUDENT_A]",
  text,
  approved_sha256: sha256Text(text),
});
