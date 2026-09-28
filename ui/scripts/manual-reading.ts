/**
 * One manual AI reading against the real proxy, with synthetic material only
 * (#53). It plays the moderator's part until the app exists (#19):
 *
 * 1. creates a new workspace (in a temporary folder) through the proxy;
 * 2. imports one synthetic submission, the synthetic rubric and brief, and
 *    anonymises and approves them;
 * 3. plans the reading and prints the worst-case estimate (nothing is sent);
 * 4. only with --confirm, runs it through the proxy, with a $1 limit, and
 *    prints what came back.
 *
 *   node scripts/manual-reading.ts "<the address the proxy printed>" [--confirm] [--two]
 *
 * With --two, both synthetic submissions are read, one after the other, and
 * each call's token use is printed, with what it would have cost without the
 * provider's prompt cache (#25): the second reading should read the shared
 * instructions, rubric and brief from the cache.
 *
 * The API key stays with the proxy; this script never sees it.
 */

import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  anonymiseWorkspace,
  approve,
  bytesSource,
  createWorkspace,
  estimatedCost,
  HttpProxyClient,
  importBrief,
  importOriginals,
  importRubric,
  loadReadings,
  openWorkspace,
  planReadings,
  recordRequest,
  runReadings,
  updateRules,
} from "../src/core/index.ts";
import { makeZip, packFile } from "../test/builders.ts";
import { NodeFileSystem } from "../test/nodeFileSystem.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { confirm: { type: "boolean", default: false }, two: { type: "boolean", default: false } } });
if (positionals.length !== 1) {
  console.error('usage: node scripts/manual-reading.ts "http://127.0.0.1:<port>/#token=<token>" [--confirm]');
  process.exit(1);
}
const address = new URL(positionals[0]);
const token = new URLSearchParams(address.hash.slice(1)).get("token");
if (!token) {
  console.error("the address has no #token=…; copy the whole address the proxy printed");
  process.exit(1);
}
// As the app would call it: same origin, with the session token.
const proxy = new HttpProxyClient(token, {
  base: address.origin,
  fetch: (url, init) => fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), origin: address.origin } }),
});

const health = await proxy.health();
console.log(`Proxy: ${address.origin}; API key ${health.key_configured ? "configured" : "NOT configured (the run will be refused)"}`);

const path = join(realpathSync(mkdtempSync(join(tmpdir(), "feedbacker-manual-"))), "manual-check");
const registration = await createWorkspace(proxy, path, { retention_days: 7, retention_source: "manual check" });
const ws = await openWorkspace(new NodeFileSystem(registration.path), proxy);
console.log(`Workspace: ${registration.path}`);

// Synthetic material only: one fictional submission, the synthetic rubric and brief.
const ids = values.two ? ["100200301", "100200302"] : ["100200301"];
await recordRequest(ws, ids.map((external_id) => ({ external_id })));
await importOriginals(
  ws,
  bytesSource(
    "originals.zip",
    makeZip({
      "100200301 - QUILL AVERY . - report.docx": packFile("submissions/sub-a.docx"),
      ...(values.two ? { "100200302 - PIKE JORDAN - report.pdf": packFile("submissions/sub-b.pdf") } : {}),
    }),
  ),
);
await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
await importBrief(ws, bytesSource("brief.docx", packFile("brief.docx")));
await updateRules(ws, { names: ["Morgan Ellis"] });
await anonymiseWorkspace(ws);
for (const id of [...(values.two ? ["sub-001", "sub-002"] : ["sub-001"]), "brief"]) await approve(ws, id);

const plan = await planReadings(ws, proxy, null, { capUsd: 1 });
for (const r of plan.readings) {
  console.log(`Plan: ${r.submissionId} ${r.pseudonym} with ${plan.model}: up to ${r.tokensIn} tokens in, ${r.tokensOut} out; at most $${r.cost.toFixed(4)} (fallback ${plan.fallbackModel}: at most $${r.fallbackCost.toFixed(4)})`);
}
for (const [id, why] of plan.skipped) console.log(`Skipped: ${id}: ${why}`);
console.log(`Estimated at most $${estimatedCost(plan).toFixed(4)} (a worst case; a real call costs much less). Spend limit: $${plan.capUsd}.`);
if (!values.confirm) {
  console.log("Nothing sent. Re-run with --confirm to send it.");
  process.exit(0);
}

let result;
try {
  result = await runReadings(ws, plan, { proxy });
} catch (err) {
  console.error(`Stopped: ${(err as Error).message}`);
  process.exit(1);
}
console.log(`\nSpent $${result.spentUsd.toFixed(4)}${result.fallbacks.length ? `; fell back for ${result.fallbacks.join(", ")}` : ""}`);
for (const [id, why] of result.failed) console.log(`Failed: ${id}: ${why}`);
for (const [id, why] of result.notRun) console.log(`Not run: ${id}: ${why}`);
for (const id of result.read.keys()) {
  console.log(`\n${id}: read by ${(await loadReadings(ws, id))[0].call.model_reported}. These are suggestions, not marks.`);
  for (const s of await loadReadings(ws, id)) {
    const verified = s.evidence.filter((e) => e.verified).length;
    console.log(`  ${s.criterion_id}: level ${s.suggested_level_id ?? "none"}; quotes ${verified} verified, ${s.evidence.length - verified} unverified${s.missing_evidence ? "; missing evidence" : ""}`);
    console.log(`    ${s.rationale.replace(/\s+/g, " ").slice(0, 200)}`);
  }
  for (const w of result.warnings.get(id) ?? []) console.log(`  warning: ${w}`);
}
// Token use per call, and what it would have cost without the cache (cache reads and writes billed as ordinary input).
const price = health.prices[plan.model];
if (price) {
  console.log("\nToken use (from each call record):");
  let withCache = 0;
  let without = 0;
  for (const id of result.read.keys()) {
    const [s] = await loadReadings(ws, id);
    const u = s.call.usage;
    const p = health.prices[s.call.model_requested] ?? price;
    const billed = (u.input_tokens + (p.cache_write ?? 1) * u.cache_write_tokens + (p.cache_read ?? 1) * u.cache_read_tokens) * p.input + u.output_tokens * p.output;
    const plain = (u.input_tokens + u.cache_write_tokens + u.cache_read_tokens) * p.input + u.output_tokens * p.output;
    withCache += billed / 1_000_000;
    without += plain / 1_000_000;
    console.log(`  ${id}: ${u.input_tokens} in, ${u.cache_write_tokens} written to the cache, ${u.cache_read_tokens} read from it, ${u.output_tokens} out: $${(billed / 1_000_000).toFixed(4)}`);
  }
  console.log(`  In all: $${withCache.toFixed(4)}; without the cache it would have been $${without.toFixed(4)}.`);
}
console.log(`\nRecords: ${join(registration.path, "readings")} (calls, raw responses, run log). Delete the workspace when done.`);
