/**
 * One manual AI reading against the real proxy, with synthetic material only
 *. It plays the moderator's part until the app exists:
 *
 * 1. creates a new workspace (in a temporary folder) through the proxy;
 * 2. imports one synthetic submission, the synthetic rubric and brief, and
 *    anonymises and approves them;
 * 3. plans the reading and prints the worst-case estimate (nothing is sent);
 * 4. only with --confirm, runs it through the proxy, with a $1 limit, and
 *    prints what came back.
 *
 *   node scripts/manual-reading.ts "<the address the proxy printed>" [--confirm] [--two] [--batch]
 *
 * With --two, both synthetic submissions are read, one after the other, and
 * each call's token use is printed, with what it would have cost without the
 * provider's prompt cache: the second reading should read the shared
 * instructions, rubric and brief from the cache.
 *
 * With --batch, the submissions are sent as one batch, and the script
 * checks it every 30 seconds until it has ended (at most a day; interrupt it
 * and collect later in the app, which finds the batch in the workspace), then
 * collects the results. Each call is billed at half the standard price.
 *
 * With --marking, the workspace is a marking one: the synthetic submissions are
 * imported as a cohort, the AI is asked with the marking instructions for
 * proposals, and the provisional mark each set of proposed levels implies is
 * printed.
 *
 * With --feedback (which implies --marking and --two), no proposals are read:
 * instead the first submission is marked high (75 on every criterion) and the
 * second low (42), each with a short comment, and feedback is drafted from
 * that marking. What of the marking is sent is printed first, then each
 * draft, so a high and a low mark's feedback on the same criterion can be
 * compared.
 *
 * With --figures (which implies --marking), two submissions are the same
 * synthetic report, whose test results are given only in a figure (a results
 * table): the first is approved with its figure, which is sent with the
 * proposals (ADR 0007); the second without it (not sent). Each one's testing
 * proposal is printed in full, to compare: only the first can read the
 * results.
 *
 * With --suggest (which implies --marking), no proposals are read: instead the
 * first submission is marked 62 (an upper second) on every criterion, two
 * pieces of feedback are recorded that the checks flag (praise above the band
 * and no next step on the first criterion; a mark named in the overall), and
 * the AI is asked to suggest an edit to each. What is sent is printed first,
 * then each suggestion, with the checks on it.
 *
 * The API key stays with the proxy; this script never sees it.
 */

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  anonymiseWorkspace,
  approve,
  bytesSource,
  checkBatch,
  collectBatch,
  createWorkspace,
  estimatedCost,
  HttpProxyClient,
  importBrief,
  importCohort,
  importOriginals,
  importRubric,
  loadReadings,
  loadRubric,
  openWorkspace,
  loadDrafts,
  planDrafts,
  planSuggestion,
  recordFeedback,
  runSuggestion,
  setFigureExcluded,
  OVERALL,
  planReadings,
  provisionalMark,
  recordJudgement,
  recordSubmissionMark,
  runDrafts,
  recordRequest,
  runReadings,
  sendBatch,
  updateRules,
} from "../src/core/index.ts";
import { loadFeedbackWork } from "../src/app/feedbackWork.ts";
import { makeZip, packFile } from "../test/builders.ts";
import { NodeFileSystem } from "../test/nodeFileSystem.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { confirm: { type: "boolean", default: false }, two: { type: "boolean", default: false }, batch: { type: "boolean", default: false }, marking: { type: "boolean", default: false }, feedback: { type: "boolean", default: false }, suggest: { type: "boolean", default: false }, figures: { type: "boolean", default: false }, keep: { type: "boolean", default: false } } });
if (values.feedback) Object.assign(values, { marking: true, two: true });
if (values.suggest) Object.assign(values, { marking: true });
if (values.figures) Object.assign(values, { marking: true, two: true });
if (positionals.length !== 1) {
  console.error('usage: node scripts/manual-reading.ts "http://127.0.0.1:<port>/#token=<token>" [--confirm] [--two] [--batch] [--marking] [--feedback] [--suggest] [--figures] [--keep]');
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
const registration = await createWorkspace(proxy, path, { retention_days: 7, retention_source: "manual check", workspace_type: values.marking ? "marking" : "moderation" });
const ws = await openWorkspace(new NodeFileSystem(registration.path), proxy);
console.log(`Workspace: ${registration.path}`);

/**
 * Leave nothing behind: the throwaway workspace is deleted and the proxy forgets it, so it doesn't linger on Your work
 * once its temporary folder is gone. With --keep, it stays, to look at, and is removed from Your work like any other.
 */
async function finish(code: number): Promise<never> {
  if (values.keep) console.log(`\nKept the workspace at ${registration.path}.`);
  else {
    rmSync(dirname(registration.path), { recursive: true, force: true });
    await proxy.forgetWorkspace(registration.registration_id).catch(() => undefined);
    console.log("\nDeleted the workspace, and the proxy has forgotten it (--keep keeps it).");
  }
  process.exit(code);
}

// Synthetic material only: one fictional submission, the synthetic rubric and brief.
const ids = values.two ? ["100200301", "100200302"] : ["100200301"];
const download = bytesSource(
  "originals.zip",
  makeZip({
    ...(values.figures
      ? { "100200301 - QUILL AVERY . - report.pdf": packFile("figures/report-with-evidence-figure.pdf"), "100200302 - PIKE JORDAN - report.pdf": packFile("figures/report-with-evidence-figure.pdf") }
      : {
          "100200301 - QUILL AVERY . - report.docx": packFile("submissions/sub-a.docx"),
          ...(values.two ? { "100200302 - PIKE JORDAN - report.pdf": packFile("submissions/sub-b.pdf") } : {}),
        }),
  }),
);
if (values.marking) await importCohort(ws, download);
else {
  await recordRequest(ws, ids.map((external_id) => ({ external_id })));
  await importOriginals(ws, download);
}
await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
await importBrief(ws, bytesSource("brief.docx", packFile("brief.docx")));
await updateRules(ws, { names: ["Morgan Ellis"] });
await anonymiseWorkspace(ws);
// The control: the same report, with its results table kept back.
if (values.figures) await setFigureExcluded(ws, "sub-002", "[FIGURE_1]", true, "The control: read without its figure");
for (const id of [...(values.two ? ["sub-001", "sub-002"] : ["sub-001"]), "brief"]) await approve(ws, id);

if (values.feedback) {
  // The educator's marking: high for the first submission, low for the second, with a short comment each.
  const rubric = await loadRubric(ws);
  for (const [id, level, overall, comment] of [["sub-001", "p75", 75, "Strong and well evidenced."], ["sub-002", "p42", 42, "Thin; much is asserted rather than shown."]] as const) {
    for (const c of rubric.criteria) await recordJudgement(ws, id, c.id, { levelId: level, comment });
    await recordSubmissionMark(ws, id, { mark: overall, comment });
  }
  const drafting = await planDrafts(ws, proxy, null, { capUsd: 1 });
  for (const d of drafting.drafts) console.log(`\nWhat will be sent of the marking of ${d.submissionId} (at most $${(d.cost + d.fallbackCost).toFixed(4)}):\n${d.marking}`);
  if (!values.confirm) {
    console.log("\nNothing sent. Re-run with --confirm to send it.");
    await finish(0);
  }
  const drafted = await runDrafts(ws, drafting, { proxy });
  console.log(`\nSpent $${drafted.spentUsd.toFixed(4)}`);
  for (const [id, why] of drafted.failed) console.log(`Failed: ${id}: ${why}`);
  for (const id of drafted.drafted.keys()) {
    console.log(`\n${id} (drafted by ${(await loadDrafts(ws, id))[0]?.call.model_reported}):`);
    for (const d of await loadDrafts(ws, id)) console.log(`  ${d.criterion_id ?? "overall"}: ${d.text}`);
  }
  console.log(`\nRecords: ${join(registration.path, "feedback")}.`);
  await finish(0);
}

if (values.suggest) {
  // The educator's marking: an upper second throughout, and feedback that overstates it, as recorded.
  const rubric = await loadRubric(ws);
  for (const c of rubric.criteria) await recordJudgement(ws, "sub-001", c.id, { levelId: "p62", comment: "Clear, but the testing is thin." });
  await recordSubmissionMark(ws, "sub-001", { mark: 62, comment: "A clear report; the testing needs more depth." });
  const first = rubric.criteria[0].id;
  await recordFeedback(ws, "sub-001", first, { text: "Your requirements are excellent and outstanding: every one is traced to the brief, and the design follows from them clearly." });
  await recordFeedback(ws, "sub-001", OVERALL, { text: "A clear report that I would place at 68%, with a sound design. Next time, test the app with real users and report what changed." });
  const plans = [await planSuggestion(ws, proxy, "sub-001", first, { capUsd: 1 }), await planSuggestion(ws, proxy, "sub-001", OVERALL, { capUsd: 1 })];
  for (const p of plans) console.log(`\nWhat will be sent to suggest an edit to ${p.target} (at most $${p.cost.toFixed(4)}):\n${p.marking}\n\n${p.feedback}`);
  if (!values.confirm) {
    console.log("\nNothing sent. Re-run with --confirm to send it.");
    await finish(0);
  }
  let spent = 0;
  for (const p of plans) {
    const came = await runSuggestion(ws, p, { proxy });
    spent += came.spentUsd;
    const row = (await loadFeedbackWork(ws, "sub-001")).rows.find((r) => r.target === p.target)!;
    console.log(`\n${p.target} (suggested by ${came.suggestion?.call.model_reported}):\n  ${came.suggestion?.text ?? "(none)"}`);
    for (const w of came.warnings) console.log(`  Warning: ${w}`);
    const flags = came.suggestion ? row.check(came.suggestion.text) : [];
    console.log(flags.length ? flags.map((f) => `  Check: ${f.message}`).join("\n") : "  No flags on the suggestion.");
  }
  console.log(`\nSpent $${spent.toFixed(4)}. Records: ${join(registration.path, "feedback")}.`);
  await finish(0);
}

const plan = await planReadings(ws, proxy, null, { capUsd: 1, batch: values.batch });
for (const r of plan.readings) {
  console.log(`Plan: ${r.submissionId} ${r.pseudonym} with ${plan.model}: up to ${r.tokensIn} tokens in, ${r.tokensOut} out; at most $${r.cost.toFixed(4)} (fallback ${plan.fallbackModel}: at most $${r.fallbackCost.toFixed(4)})`);
  const block = r.request.blocks.at(-1)!;
  if (block.figures?.length || block.figures_not_sent?.length) console.log(`  Figures: ${block.figures?.map((f) => f.placeholder).join(", ") || "none"} sent; ${block.figures_not_sent?.join(", ") || "none"} not sent`);
}
for (const [id, why] of plan.skipped) console.log(`Skipped: ${id}: ${why}`);
console.log(`Estimated at most $${estimatedCost(plan).toFixed(4)} (a worst case; a real call costs much less). Spend limit: $${plan.capUsd}.`);
if (!values.confirm) {
  console.log("Nothing sent. Re-run with --confirm to send it.");
  await finish(0);
}

let result;
try {
  if (values.batch) {
    const sent = await sendBatch(ws, plan, { proxy });
    if (!sent.batch) throw new Error(`nothing was sent in a batch: ${JSON.stringify({ failed: [...sent.result.failed], notRun: [...sent.result.notRun] })}`);
    console.log(`\nSent batch ${sent.batch.id} at ${new Date().toISOString()}; checking every 30 seconds.`);
    let progress = await checkBatch(proxy, sent.batch.id);
    while (progress.status !== "ended") {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      progress = await checkBatch(proxy, sent.batch.id);
      console.log(`  ${new Date().toISOString()}: ${progress.status} ${JSON.stringify(progress.counts)}`);
    }
    result = await collectBatch(ws, proxy, sent.batch.id);
  } else {
    result = await runReadings(ws, plan, { proxy });
  }
} catch (err) {
  console.error(`Stopped: ${(err as Error).message}`);
  throw await finish(1); // (finish exits; throw tells the type checker so)
}
console.log(`\nSpent $${result.spentUsd.toFixed(4)}${result.fallbacks.length ? `; fell back for ${result.fallbacks.join(", ")}` : ""}`);
for (const [id, why] of result.failed) console.log(`Failed: ${id}: ${why}`);
for (const [id, why] of result.notRun) console.log(`Not run: ${id}: ${why}`);
for (const id of result.read.keys()) {
  const readings = await loadReadings(ws, id);
  console.log(`\n${id}: read by ${readings[0].call.model_reported} with ${readings[0].call.prompt_version}. These are ${values.marking ? "proposals" : "suggestions"}, not marks.`);
  if (values.marking) {
    const provisional = provisionalMark((await loadRubric(ws)).criteria, (c) => readings.find((r) => r.criterion_id === c));
    console.log(`  ${"mark" in provisional ? `Provisional mark ${provisional.mark}, from the proposed levels` : `No provisional mark: ${provisional.missing}`}`);
  }
  for (const s of await loadReadings(ws, id)) {
    const verified = s.evidence.filter((e) => e.verified).length;
    console.log(`  ${s.criterion_id}: level ${s.suggested_level_id ?? "none"}; quotes ${verified} verified, ${s.evidence.length - verified} unverified${s.missing_evidence ? "; missing evidence" : ""}`);
    console.log(`    ${s.rationale.replace(/\s+/g, " ").slice(0, values.figures ? undefined : 200)}`);
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
    const share = s.call.produced_by === "batch" ? (p.batch ?? 1) : 1;
    const billed = ((u.input_tokens + (p.cache_write ?? 1) * u.cache_write_tokens + (p.cache_read ?? 1) * u.cache_read_tokens) * p.input + u.output_tokens * p.output) * share;
    const plain = (u.input_tokens + u.cache_write_tokens + u.cache_read_tokens) * p.input + u.output_tokens * p.output;
    withCache += billed / 1_000_000;
    without += plain / 1_000_000;
    console.log(`  ${id} (${s.call.produced_by}): ${u.input_tokens} in, ${u.cache_write_tokens} written to the cache, ${u.cache_read_tokens} read from it, ${u.output_tokens} out: $${(billed / 1_000_000).toFixed(4)}`);
  }
  console.log(`  In all: $${withCache.toFixed(4)}; standard calls without the cache would have cost $${without.toFixed(4)}.`);
}
console.log(`\nRecords: ${join(registration.path, "readings")} (calls, raw responses, run log).`);
await finish(0);
