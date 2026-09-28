/**
 * The AI reading, end to end: the core plans and sends through the real proxy
 * (in-process), whose real Anthropic adapter and SDK talk to a scripted fake
 * API. No test contacts the API or spends money. A port of
 * `core/tests/test_reading.py`, including the gate tests carried over from
 * #50.
 *
 * Two Python tests stay with other code: reading the API key is the proxy's
 * job, and `proxy/test/key.test.ts` tests it (the environment, the private
 * .env file, its permissions, and that the key never appears in errors); and
 * the command line's output formatting stays in Python (the behaviour behind
 * it, estimating without sending and then running, is tested here).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { fakeAnthropic, type Reply } from "../../proxy/test/fakeAnthropic.ts";
import {
  anonymiseWorkspace,
  approve,
  bytesSource,
  estimatedCost,
  FALLBACK_MODEL,
  importBrief,
  importOriginals,
  importRubric,
  loadReadings,
  loadRubric,
  MAX_OUTPUT_TOKENS,
  OUTPUT_SCHEMA,
  planReadings,
  ProxyRefusal,
  ReadingError,
  recordRequest,
  runReadings,
  updateRules,
  type HttpProxyClient,
  type Workspace,
  REUSE,
  requestKey,
} from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

let ws: Workspace;
let path: string;
let proxy: HttpProxyClient;
let replies: ((body: any) => Reply)[];
let sent: any[];

async function setUp(name: string, withBrief: boolean, ids = ["100200301", "100200302"]) {
  replies = [];
  const fake = fakeAnthropic(replies);
  sent = fake.sent;
  const made = await newWorkspace(name, { provider: fake.provider });
  const files: Record<string, Uint8Array> = { "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx") };
  if (ids.includes("100200302")) files["100200302 - PIKE JORDAN - b.pdf"] = packFile("submissions/sub-b.pdf");
  await recordRequest(made.ws, ids.map((external_id) => ({ external_id })));
  await importOriginals(made.ws, bytesSource("o.zip", makeZip(files)));
  await importRubric(made.ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  if (withBrief) await importBrief(made.ws, bytesSource("brief.docx", packFile("brief.docx")));
  await updateRules(made.ws, { names: ["Morgan Ellis"] });
  await anonymiseWorkspace(made.ws);
  for (const id of ["sub-001", ...(ids.includes("100200302") ? ["sub-002"] : []), ...(withBrief ? ["brief"] : [])]) await approve(made.ws, id);
  return made;
}

beforeEach(async () => {
  ({ ws, path, client: proxy } = await setUp("mod-1", true));
});

// --- A scripted model ------------------------------------------------------------------------

const usage = (input = 5000, output = 2000) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
const message = (text: string, stop_reason = "end_turn", model = "claude-sonnet-5", u = usage()): Reply => ({
  message: { model, content: text ? [{ type: "text", text }] : [], stop_reason, usage: u },
  requestId: `req_${model}`,
});

/** A valid structured reading; quotes one real passage and one invented one. */
function goodReading(criteria: string[], options: { level?: string; model?: string; usage?: ReturnType<typeof usage> } = {}) {
  return (body: any): Reply => {
    const text: string = body.messages[0].content[2].text;
    // As Python's text.split("\n\n", 2)[-1][:40].
    const parts = text.split("\n\n");
    const real = [...(parts.length > 2 ? parts.slice(2).join("\n\n") : parts.at(-1)!)].slice(0, 40).join("");
    const reading = {
      criteria: criteria.map((criterion_id) => ({
        criterion_id,
        suggested_level_id: options.level ?? "p68",
        rationale: "Fits the descriptor.",
        evidence: [real, "a sentence that is not in the submission"],
        draft_comment: "Consider evaluating against your requirements.",
        missing_evidence: false,
      })),
    };
    return message(JSON.stringify(reading), "end_turn", options.model, options.usage);
  };
}
const criteriaOf = async (w: Workspace) => (await loadRubric(w)).criteria.map((c) => c.id);

// --- Planning and estimates -------------------------------------------------------------------

test("a plan estimates without sending", async () => {
  const plan = await planReadings(ws, proxy);
  expect(plan.readings.map((r) => r.submissionId)).toEqual(["sub-001", "sub-002"]);
  expect([plan.model, plan.fallbackModel, plan.withBrief]).toEqual(["claude-sonnet-5", "claude-opus-5", true]);
  expect(estimatedCost(plan)).toBeGreaterThan(0);
  expect(estimatedCost(plan)).toBeLessThan(5);
  expect(sent).toEqual([]);
});

test("a plan skips unapproved submissions, and requires an approved brief", async () => {
  await updateRules(ws, { redact: { MoSCoW: "REDACTED" } });
  await anonymiseWorkspace(ws); // clears sub-001's approval; the brief is unchanged
  const plan = await planReadings(ws, proxy);
  expect(plan.skipped.get("sub-001")).toContain("not been approved");
  await updateRules(ws, { redact: { "Office hours": "REDACTED" } });
  await anonymiseWorkspace(ws); // now the brief's approval is cleared too
  await expect(planReadings(ws, proxy)).rejects.toThrow("approve it");
});

test("an unknown model and a bad limit are refused", async () => {
  await expect(planReadings(ws, proxy, null, { model: "claude-imaginary-9" })).rejects.toThrow("no price is known");
  await expect(planReadings(ws, proxy, null, { capUsd: 0 })).rejects.toThrow("greater than 0");
});

// --- What is sent --------------------------------------------------------------------------------

test("only approved anonymised text is sent, never the original marks", async () => {
  const criteria = await criteriaOf(ws);
  replies.push(goodReading(criteria), goodReading(criteria));
  await runReadings(ws, await planReadings(ws, proxy), { proxy });
  expect(sent).toHaveLength(2);
  for (const body of sent) {
    const text = JSON.stringify(body);
    for (const real of ["Avery Quill", "Quill", "Jordan Pike", "S0000101", "avery.quill@example.com", "Morgan Ellis", "m.ellis@example.com", "100200301"]) {
      expect(text, real).not.toContain(real);
    }
    // The original marker's marks and comments are never part of a request.
    expect(text).not.toContain("Excellent, well-evidenced work throughout");
    expect(text).not.toContain("Good app, nice use of React");
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.output_config.format.schema).toEqual(OUTPUT_SCHEMA);
    expect("temperature" in body).toBe(false);
  }
  expect(JSON.stringify(sent[0])).toContain("[STUDENT_A]");
  expect(sent[0].messages[0].content[1].text).toContain("ASSESSMENT BRIEF");
});

test("the gate is rechecked immediately before sending", async () => {
  const plan = await planReadings(ws, proxy);
  await updateRules(ws, { redact: { MoSCoW: "REDACTED" } });
  await anonymiseWorkspace(ws); // sub-001 changed after planning: its approval is gone
  replies.push(goodReading(await criteriaOf(ws)));
  const result = await runReadings(ws, plan, { proxy });
  expect(result.failed.get("sub-001")).toContain("not been approved");
  expect(sent).toHaveLength(1); // only sub-002 was sent
});

// --- Results ---------------------------------------------------------------------------------------

test("suggestions record provenance, and quotes are verified", async () => {
  const criteria = await criteriaOf(ws);
  replies.push(goodReading(criteria), goodReading(criteria));
  await runReadings(ws, await planReadings(ws, proxy), { proxy });
  const suggestions = await loadReadings(ws, "sub-001");
  expect(suggestions).toHaveLength(4);
  const s = suggestions[0];
  expect(s.suggested_level_id).toBe("p68");
  expect(s.provenance.actor.kind).toBe("model");
  expect(s.evidence.map((e) => e.verified)).toEqual([true, false]);
  const call = s.call;
  expect([call.prompt_version, call.model_reported]).toEqual(["reading-v1", "claude-sonnet-5"]);
  expect(call.approval_id.startsWith("appr-sub-001-")).toBe(true);
  expect(call.brief_approval_id!.startsWith("appr-brief-")).toBe(true);
  expect(call.brief_sha256).toBeTruthy();
  expect([call.usage.input_tokens, call.fallback_from]).toEqual([5000, null]);
  const raw = readdirSync(join(path, "readings", "raw"));
  expect(raw.length).toBeGreaterThan(0);
  expect(statSync(join(path, "readings", "raw", raw[0])).mode & 0o777).toBe(0o600);
  const [runLog] = readdirSync(join(path, "readings", "runs"));
  const log = JSON.parse(readFileSync(join(path, "readings", "runs", runLog), "utf8"));
  expect(log.spent_usd).toBeGreaterThan(0);
  expect(log.calls).toHaveLength(2);
});

test("invalid levels and criteria are flagged, not trusted", async () => {
  const [first] = await criteriaOf(ws);
  const odd = {
    criteria: [
      { criterion_id: first, suggested_level_id: "p999", rationale: "?", evidence: [], draft_comment: "", missing_evidence: false },
      { criterion_id: "invented", suggested_level_id: null, rationale: "?", evidence: [], draft_comment: "", missing_evidence: true },
    ],
  };
  replies.push(() => message(JSON.stringify(odd)));
  const result = await runReadings(ws, await planReadings(ws, proxy, ["sub-001"]), { proxy });
  const warnings = result.warnings.get("sub-001")!.join("\n");
  expect(warnings).toContain("'p999' is not a level");
  expect(warnings).toContain("unknown criteria: invented");
  expect(warnings).toContain("no reading returned for criterion 'implementation'");
  const [s] = await loadReadings(ws, "sub-001");
  expect(s.suggested_level_id).toBeNull();
  expect(s.missing_evidence).toBe(true);
});

test("a truncated reading fails", async () => {
  replies.push(() => message("", "max_tokens"));
  const result = await runReadings(ws, await planReadings(ws, proxy, ["sub-001"]), { proxy });
  expect(result.failed.get("sub-001")).toContain("stop reason: max_tokens");
});

// --- Spend limit, fallback, and errors --------------------------------------------------------------

test("the spend limit stops the run", async () => {
  const perCall = (await planReadings(ws, proxy)).readings[0].cost;
  const plan = await planReadings(ws, proxy, null, { capUsd: perCall * 1.5 }); // room for one call, not two
  // The first call really costs about its worst case, so the second no longer fits.
  const criteria = await criteriaOf(ws);
  replies.push(goodReading(criteria, { usage: usage(20000, 8000) }), goodReading(criteria, { usage: usage(20000, 8000) }));
  const result = await runReadings(ws, plan, { proxy });
  expect([...result.read.keys()]).toEqual(["sub-001"]);
  expect(result.notRun.get("sub-002")).toContain("spend limit would be exceeded");
  expect(sent).toHaveLength(1);
});

test("a refusal falls back to Opus, and both are recorded", async () => {
  replies.push(() => message("", "refusal"), goodReading(await criteriaOf(ws), { model: "claude-opus-5" }));
  const result = await runReadings(ws, await planReadings(ws, proxy, ["sub-001"]), { proxy });
  expect(result.fallbacks).toEqual(["sub-001"]);
  expect(result.read.has("sub-001")).toBe(true);
  expect(sent.map((b) => b.model)).toEqual(["claude-sonnet-5", "claude-opus-5"]);
  const { call } = (await loadReadings(ws, "sub-001"))[0];
  expect([call.fallback_from, call.model_requested]).toEqual(["claude-sonnet-5", "claude-opus-5"]);
});

test("a refusal without the fallback is recorded as declined", async () => {
  replies.push(() => message("", "refusal"));
  const result = await runReadings(ws, await planReadings(ws, proxy, ["sub-001"], { fallback: false }), { proxy });
  expect(result.failed.get("sub-001")).toContain("declined");
  expect(sent).toHaveLength(1);
});

test("a rejected key stops the run cleanly", async () => {
  replies.push(() => ({ status: 401 }));
  await expect(runReadings(ws, await planReadings(ws, proxy), { proxy })).rejects.toThrow(new ReadingError("the API key was rejected (expired, revoked, or without access); create a new key and update ~/Feedbacker/.env"));
  expect(readdirSync(join(path, "readings", "runs"))).toHaveLength(1); // the run is still logged
});

test("a server error fails one submission only", async () => {
  replies.push(() => ({ status: 500 }), goodReading(await criteriaOf(ws)));
  const result = await runReadings(ws, await planReadings(ws, proxy), { proxy });
  expect(result.failed.get("sub-001")).toContain("HTTP 500");
  expect(result.read.has("sub-002")).toBe(true);
});

// --- As the command line does ---------------------------------------------------------------------

test("an estimate sends nothing; running reads; a second plan skips what was read", async () => {
  const criteria = await criteriaOf(ws);
  replies.push(goodReading(criteria), goodReading(criteria));
  const plan = await planReadings(ws, proxy);
  expect(sent).toEqual([]);
  const result = await runReadings(ws, plan, { proxy });
  expect([...result.read.keys()]).toEqual(["sub-001", "sub-002"]);
  expect(result.spentUsd).toBeGreaterThan(0);
  expect(sent).toHaveLength(2);
  expect((await planReadings(ws, proxy)).skipped.get("sub-001")).toContain("already read");
});

// --- Review fixes (Python) ---------------------------------------------------------------------------

test("a brief changed after confirming is not sent", async () => {
  const plan = await planReadings(ws, proxy, ["sub-001"]);
  await updateRules(ws, { redact: { "Office hours": "REDACTED" } });
  await anonymiseWorkspace(ws);
  await approve(ws, "brief"); // re-approved, but not the brief the moderator confirmed
  replies.push(goodReading(await criteriaOf(ws)));
  const result = await runReadings(ws, plan, { proxy });
  expect(result.failed.get("sub-001")).toContain("changed after you confirmed the estimate");
  expect(sent).toEqual([]);
});

test("a rubric replaced after confirming is not sent", async () => {
  const plan = await planReadings(ws, proxy, ["sub-001"]);
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic", version: "2", replace: true });
  replies.push(goodReading(await criteriaOf(ws)));
  const result = await runReadings(ws, plan, { proxy });
  expect(result.failed.get("sub-001")).toContain("changed after you confirmed the estimate");
  expect(sent).toEqual([]);
});

test("a missing brief needs an explicit opt-out", async () => {
  const nobrief = await setUp("nobrief", false, ["100200301"]);
  await expect(planReadings(nobrief.ws, nobrief.client)).rejects.toThrow("no brief has been imported");
  const plan = await planReadings(nobrief.ws, nobrief.client, null, { withBrief: false });
  replies.push(goodReading(await criteriaOf(nobrief.ws)));
  await runReadings(nobrief.ws, plan, { proxy: nobrief.client });
  expect(sent[0].messages[0].content[1].text).toContain("(No brief was provided.)");
  const { call } = (await loadReadings(nobrief.ws, "sub-001"))[0];
  expect([call.brief_approval_id, call.brief_sha256]).toEqual([null, null]);
  const [runLog] = readdirSync(join(nobrief.path, "readings", "runs"));
  expect(JSON.parse(readFileSync(join(nobrief.path, "readings", "runs", runLog), "utf8")).with_brief).toBe(false);
});

test("the estimate covers the full output and the fallback", async () => {
  const plan = await planReadings(ws, proxy);
  const r = plan.readings[0];
  expect(r.tokensOut).toBe(MAX_OUTPUT_TOKENS);
  expect(r.fallbackCost).toBeGreaterThan(r.cost);
  expect(r.cost).toBeGreaterThan(0);
  expect(estimatedCost(plan)).toBeCloseTo(plan.readings.reduce((n, x) => n + x.cost + x.fallbackCost, 0), 12);
  expect((await planReadings(ws, proxy, null, { fallback: false })).readings[0].fallbackCost).toBe(0);
});

test("refused and truncated calls leave an audit trail", async () => {
  replies.push(() => message("", "refusal"), () => message("", "max_tokens", FALLBACK_MODEL));
  const result = await runReadings(ws, await planReadings(ws, proxy, ["sub-001"]), { proxy });
  expect(result.failed.has("sub-001")).toBe(true);
  const dir = join(path, "readings", "calls");
  const records = readdirSync(dir).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  expect(records.map((r) => r.outcome).sort()).toEqual(["refused", "truncated"]);
  expect(new Set(records.map((r) => r.call.error))).toEqual(new Set(["refused", "truncated"]));
  expect(records.every((r) => r.call.response_sha256 && r.call.request_sha256)).toBe(true);
  expect(readdirSync(join(path, "readings", "raw"))).toHaveLength(2);
});

test("the reading knows no provider SDK", () => {
  const source = readFileSync(new URL("../src/core/reading.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/@anthropic-ai|from ["']anthropic|new Anthropic/);
});

// --- Through the proxy (beyond the Python tests) ---------------------------------------------

test("if approved text still looks identifying, the proxy refuses it and nothing is sent", async () => {
  // The moderator told anonymisation to ignore an email, then approved the text anyway.
  await updateRules(ws, { ignore: ["avery.quill@example.com"] });
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
  const result = await runReadings(ws, await planReadings(ws, proxy, ["sub-001"]), { proxy });
  expect(result.failed.get("sub-001")).toContain("not sent, because it may identify someone: the submission block contains an email address");
  expect(sent).toEqual([]);
});

test("a proxy without an API key stops the run before anything is sent", async () => {
  // A second proxy, started without a key (its workspace isn't used).
  const { client: keyless } = await newWorkspace("nokey");
  const plan = await planReadings(ws, proxy, ["sub-001"]);
  await expect(runReadings(ws, plan, { proxy: keyless })).rejects.toThrow("no API key is configured");
  expect(sent).toEqual([]);
});

test("a reply that isn't the reading's shape is unparsed, never trusted", async () => {
  replies.push(() => message(JSON.stringify({ criteria: [{ criterion_id: "x" }] })));
  const result = await runReadings(ws, await planReadings(ws, proxy, ["sub-001"]), { proxy });
  expect(result.failed.get("sub-001")).toContain("the reading was incomplete (unparsed");
});

test("the prompt is Python's, verbatim", async () => {
  const { PROMPTS } = await import("../src/core/prompts.ts");
  expect(PROMPTS["reading-v1"]).toBe(readFileSync(new URL("../../core/src/feedbacker_core/prompts/reading-v1.md", import.meta.url), "utf8"));
});

// --- Review of #64 --------------------------------------------------------------------------------

const callRecords = () => {
  const dir = join(path, "readings", "calls");
  return readdirSync(dir).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
};
const runLog = () => {
  const [f] = readdirSync(join(path, "readings", "runs"));
  return JSON.parse(readFileSync(join(path, "readings", "runs", f), "utf8"));
};

test("a server error leaves a call record, with the error and no response", async () => {
  replies.push(() => ({ status: 500 }), goodReading(await criteriaOf(ws)));
  await runReadings(ws, await planReadings(ws, proxy), { proxy });
  const [failed, ok] = callRecords();
  expect(failed.outcome).toBe("provider_error");
  expect(failed.call.error).toContain("HTTP 500");
  expect([failed.call.response_sha256, failed.call.request_id]).toEqual([null, null]);
  expect(failed.call.request_sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(failed.call.approval_id.startsWith("appr-sub-001-")).toBe(true);
  expect(ok.outcome).toBe("complete");
  expect(readdirSync(join(path, "readings", "raw"))).toHaveLength(1); // only the call that got a response
  expect(runLog().calls.map((c: any) => c.outcome)).toEqual(["provider_error", "complete"]);
  // It is private, like every record of the reading.
  expect(statSync(join(path, "readings", "calls", readdirSync(join(path, "readings", "calls")).sort()[0])).mode & 0o777).toBe(0o600);
});

test("a rejected key is recorded before the run stops", async () => {
  replies.push(() => ({ status: 401 }));
  await expect(runReadings(ws, await planReadings(ws, proxy), { proxy })).rejects.toThrow("API key was rejected");
  const [record] = callRecords();
  expect([record.outcome, record.call.error]).toEqual(["provider_error", "the API key was rejected (expired, revoked, or without access); create a new key and update ~/Feedbacker/.env"]);
  expect(runLog().calls).toHaveLength(1);
});

test("if the proxy refuses for the spend limit, that submission and the rest are not run", async () => {
  const limited = {
    health: () => proxy.health(),
    openRun: (limit: number, estimate: number) => proxy.openRun(limit, estimate),
    read: async () => {
      throw new ProxyRefusal("spend", "the $1 spend limit would be exceeded");
    },
  };
  const result = await runReadings(ws, await planReadings(ws, proxy), { proxy: limited });
  expect(Object.fromEntries(result.notRun)).toEqual({ "sub-001": "the $1 spend limit would be exceeded", "sub-002": "the $1 spend limit would be exceeded" });
  expect(result.failed.size).toBe(0);
  expect(sent).toEqual([]);
});

test("a reading that read the shared prefix from the cache is counted from its call, even with nothing suggested", async () => {
  const cached = { input_tokens: 200, output_tokens: 50, cache_read_input_tokens: 2900, cache_creation_input_tokens: 0 };
  replies.push(goodReading(await criteriaOf(ws)), () => message(JSON.stringify({ criteria: [] }), "end_turn", "claude-sonnet-5", cached));
  const plan = await planReadings(ws, proxy, null, { fallback: false });
  const result = await runReadings(ws, plan, { proxy });
  expect(result.read.get("sub-002")).toEqual([]); // nothing recognised, but the call happened
  expect(result.cached).toEqual(["sub-002"]);
});

// --- Exact-match reuse (#25) ------------------------------------------------------------------

test("a reading of exactly the same request is reused, with no call, and says so", async () => {
  const criteria = await criteriaOf(ws);
  replies.push(goodReading(criteria), goodReading(criteria));
  const first = await runReadings(ws, await planReadings(ws, proxy), { proxy });
  const original = (await loadReadings(ws, "sub-001"))[0].call;
  expect(sent).toHaveLength(2);

  const plan = await planReadings(ws, proxy, null, { replace: true });
  expect(plan.readings.map((r) => [r.submissionId, r.reuse !== null, r.cost, r.fallbackCost])).toEqual([
    ["sub-001", true, 0, 0],
    ["sub-002", true, 0, 0],
  ]);
  const result = await runReadings(ws, plan, { proxy });
  expect(sent).toHaveLength(2); // nothing more was sent
  expect(result.reused).toEqual(["sub-001", "sub-002"]);
  expect(result.spentUsd).toBe(0);
  const reused = await loadReadings(ws, "sub-001");
  expect(reused[0].call).toMatchObject({
    produced_by: "cache",
    cached_from_request_id: original.request_id,
    request_id: null,
    request_sha256: original.request_sha256, // the identical request
    usage: { input_tokens: 0, output_tokens: 0 },
  });
  expect(reused.map((s) => [s.criterion_id, s.suggested_level_id, s.rationale])).toEqual(
    (first.read.get("sub-001") ?? []).map((s) => [s.criterion_id, s.suggested_level_id, s.rationale]),
  );
  expect(reused[0].provenance.source).toBe(`reused from model call ${original.request_id}`);
});

test("asking the model again, or any change to what would be sent, reads it live", async () => {
  const criteria = await criteriaOf(ws);
  replies.push(goodReading(criteria), goodReading(criteria));
  await runReadings(ws, await planReadings(ws, proxy), { proxy });
  // Asked to read again even though nothing changed.
  expect((await planReadings(ws, proxy, null, { replace: true, rereadUnchanged: true })).readings.every((r) => r.reuse === null)).toBe(true);
  // Another model is another request.
  expect((await planReadings(ws, proxy, null, { replace: true, model: "claude-opus-5" })).readings.every((r) => r.reuse === null)).toBe(true);
  // A different brief (read without one) is another request.
  expect((await planReadings(ws, proxy, null, { replace: true, withBrief: false })).readings.every((r) => r.reuse === null)).toBe(true);
});

test("a reading is never reused for another submission, even filed under its request's key", async () => {
  const criteria = await criteriaOf(ws);
  replies.push(goodReading(criteria), goodReading(criteria));
  await runReadings(ws, await planReadings(ws, proxy), { proxy });
  const plan = await planReadings(ws, proxy, null, { replace: true });
  const [one, two] = plan.readings;
  // sub-001's reading, placed where sub-002's would be found.
  await ws.writeJson(`${REUSE}/${requestKey(two.request)}.json`, { ...((await ws.readJson(`${REUSE}/${one.reuse!.key}.json`)) as object) });
  expect((await planReadings(ws, proxy, null, { replace: true })).readings.find((r) => r.submissionId === "sub-002")!.reuse).toBeNull();
});
