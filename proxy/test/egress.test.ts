/** The egress log records every request without holding any of its content. */

import { statSync } from "node:fs";
import { expect, test } from "vitest";
import { EgressLog } from "../src/egress.ts";
import { makeProxy, readRequest, submission, tempDir } from "./helpers.ts";

test("forwarded and refused requests are logged by hash, with no text or names", async () => {
  const { call, openRun, egress, egressText } = makeProxy();
  const run = await openRun();
  const ok = await (await call(`/api/runs/${run}/read`, { body: readRequest() })).json();
  const { blocks } = readRequest();
  await call(`/api/runs/${run}/read`, { body: readRequest({ blocks: [blocks[0], submission("Mail jordan.pike@example.com")] }) });

  const [sent, refused] = egress.entries();
  expect(sent).toEqual({
    time: "2026-01-15T09:00:00.000Z",
    run_id: run,
    model: "claude-sonnet-5",
    prompt_version: "reading-v1",
    request_sha256: ok.request_sha256,
    outcome: "complete",
    refusal: null,
    usage: { input_tokens: 1000, output_tokens: 500, cache_read_tokens: 0, cache_write_tokens: 0 },
    cost_usd: ok.cost_usd,
  });
  expect(refused).toMatchObject({ outcome: "refused_by_proxy", refusal: "leak", request_sha256: null, usage: null });

  const log = egressText();
  for (const content of ["STUDENT_A", "planner", "jordan", "example.com", "RUBRIC", "Read the submission"]) {
    expect(log).not.toContain(content);
  }
  expect(statSync(egress.path).mode & 0o777).toBe(0o600);
});

test("entries older than the retention period are pruned", () => {
  const log = new EgressLog(`${tempDir()}/egress.jsonl`, 90);
  const entry = (time: string) => ({ time, run_id: null, model: null, prompt_version: null, request_sha256: null, outcome: "x", refusal: null, usage: null, cost_usd: null });
  log.record(entry("2026-01-01T00:00:00Z"));
  log.record(entry("2026-05-01T00:00:00Z"));
  expect(log.prune(new Date("2026-06-01T00:00:00Z"))).toBe(1);
  expect(log.entries().map((e) => e.time)).toEqual(["2026-05-01T00:00:00Z"]);
});
