/**
 * Two-way check with Python for the AI reading (#53). The same approved
 * material goes into two workspaces; the TypeScript core reads one through
 * the real proxy (whose Anthropic adapter talks to a scripted fake API), and
 * Python reads the other with its own fake client, with the same model reply
 * and the same clock. The suggestions must match field by field, except the
 * hashes of what was sent (Python hashes its SDK request; the proxy hashes
 * what it sends). Then each side loads the other's readings.
 *
 *   node scripts/interop-reading.ts      (needs uv and the core environment)
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fakeAnthropic, type Reply } from "../../proxy/test/fakeAnthropic.ts";
import {
  anonymiseWorkspace,
  approve,
  bytesSource,
  createWorkspace,
  importBrief,
  importOriginals,
  importRubric,
  loadReadings,
  loadRubric,
  loadSubmission,
  openWorkspace,
  planReadings,
  recordRequest,
  runReadings,
  updateRules,
  type Workspace,
} from "../src/core/index.ts";
import { makeZip, PACK, packFile } from "../test/builders.ts";
import { NodeFileSystem } from "../test/nodeFileSystem.ts";
import { realProxy, tempDir } from "../test/proxyHarness.ts";

const python = (code: string) =>
  JSON.parse(execFileSync("uv", ["run", "--quiet", "--project", "../core", "python", "-c", code], { encoding: "utf8", cwd: process.cwd() }).trim() || "null");

const replies: ((body: any) => Reply)[] = [];
const fake = fakeAnthropic(replies);
const { client } = realProxy({ provider: fake.provider });
const root = tempDir();
let failures = 0;
const check = (what: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${!ok && detail ? `: ${detail}` : ""}`);
};
const NOW = "2026-09-27T14:00:00.123Z";

try {
  const zip = join(root, "o.zip");
  writeFileSync(zip, makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx"), "100200302 - PIKE JORDAN - b.pdf": packFile("submissions/sub-b.pdf") }));
  const open = async (name: string): Promise<[Workspace, string]> => {
    const registration = await createWorkspace(client, join(root, name), { retention_days: 45, retention_source: "terms" });
    return [await openWorkspace(new NodeFileSystem(registration.path), client), registration.path];
  };
  const [tsWs, tsPath] = await open("by-typescript");
  const [, pyPath] = await open("by-python");
  const now = new Date(NOW);

  // The same approved material in both workspaces, each made by its own core.
  await recordRequest(tsWs, [{ external_id: "100200301" }, { external_id: "100200302" }], { now });
  await importOriginals(tsWs, bytesSource("o.zip", new Uint8Array(readFileSync(zip))), { now });
  await importRubric(tsWs, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic", now });
  await importBrief(tsWs, bytesSource("brief.docx", packFile("brief.docx")), { now });
  await updateRules(tsWs, { names: ["Morgan Ellis"] });
  await anonymiseWorkspace(tsWs, { now });
  for (const id of ["sub-001", "sub-002", "brief"]) await approve(tsWs, id, now);

  // One scripted reply for each submission: a real quote, an invented one, and one bad level.
  const criteria = (await loadRubric(tsWs)).criteria.map((c) => c.id);
  const readingFor = async (id: string) => {
    const text = (await loadSubmission(tsWs, id)).anonymised!.text;
    return {
      criteria: criteria.map((criterion_id, i) => ({
        criterion_id,
        suggested_level_id: i === 1 ? "p999" : "p68",
        rationale: "Fits the descriptor.",
        evidence: [[...text].slice(10, 50).join(""), "a sentence that is not in the submission", " "],
        draft_comment: i === 2 ? "" : "Consider evaluating against your requirements.",
        missing_evidence: false,
      })),
    };
  };
  const readings = { "sub-001": await readingFor("sub-001"), "sub-002": await readingFor("sub-002") };
  const usage = { input_tokens: 5000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  for (const id of ["sub-001", "sub-002"] as const) {
    replies.push(() => ({ message: { model: "claude-sonnet-5", content: [{ type: "text", text: JSON.stringify(readings[id]) }], stop_reason: "end_turn", usage }, requestId: "req_claude-sonnet-5" }));
  }
  const tsResult = await runReadings(tsWs, await planReadings(tsWs, client), { proxy: client, now: () => now });

  const pyResult = python(`
import json, sys
from datetime import datetime
from pathlib import Path
sys.path.insert(0, "../core/tests")
from test_reading import FakeClient, FakeResponse
from feedbacker_core.anonymise import anonymise_workspace, approve, update_rules
from feedbacker_core.brief import import_brief
from feedbacker_core.originals import import_originals
from feedbacker_core.providers.anthropic import AnthropicProvider
from feedbacker_core.reading import ReadingOut, load_readings, plan_readings, run_readings
from feedbacker_core.request import SampleEntry, record_request
from feedbacker_core.rubric_import import import_rubric
from feedbacker_core.workspace import Workspace
now = datetime.fromisoformat(${JSON.stringify(NOW)})
ws = Workspace.open(Path(${JSON.stringify(pyPath)}))
record_request(ws, [SampleEntry("100200301"), SampleEntry("100200302")], now=now)
import_originals(ws, Path(${JSON.stringify(zip)}), now=now)
import_rubric(ws, Path(${JSON.stringify(new URL("rubric.csv", PACK).pathname)}), title="Synthetic", now=now)
import_brief(ws, Path(${JSON.stringify(new URL("brief.docx", PACK).pathname)}), now=now)
update_rules(ws, names=["Morgan Ellis"])
anonymise_workspace(ws, now=now)
for rid in ("sub-001", "sub-002", "brief"):
    approve(ws, rid, now=now)
readings = json.loads(${JSON.stringify(JSON.stringify(readings))})
client = FakeClient(*[FakeResponse(ReadingOut.model_validate(readings[i])) for i in ("sub-001", "sub-002")])
result = run_readings(ws, plan_readings(ws, provider=AnthropicProvider(client=client)), provider=AnthropicProvider(client=client), now=lambda: now)
theirs = Workspace.open(Path(${JSON.stringify(tsPath)}))
print(json.dumps({
    "read": sorted(result.read), "failed": result.failed, "warnings": result.warnings,
    "ts_loaded": {i: [s.model_dump(mode="json") for s in load_readings(theirs, i)] for i in ("sub-001", "sub-002")},
}))
`);
  check("both read the same submissions, with the same warnings", isDeepStrictEqual({ read: [...tsResult.read.keys()].sort(), failed: Object.fromEntries(tsResult.failed), warnings: Object.fromEntries(tsResult.warnings) }, { read: pyResult.read, failed: pyResult.failed, warnings: pyResult.warnings }), JSON.stringify(pyResult.warnings));

  const pyWs = await openWorkspace(new NodeFileSystem(pyPath), client);
  // What each core hashes as "the request" differs by design; so do the raw responses' hashes.
  // Each reading's ids end with a token of its own, different on each side: its form is checked, then it is masked.
  const ownId = (s: any) => (/-[0-9a-f]{12}$/.test(s.id) ? s.id.slice(0, -12) : `${s.id} (no reading token)`);
  const mask = (s: any) => ({ ...s, id: ownId(s), call: { ...s.call, request_sha256: "-", response_sha256: "-" }, provenance: { ...s.provenance, input_hashes: s.provenance.input_hashes.filter((h: string) => h !== s.call.request_sha256) } });
  for (const id of ["sub-001", "sub-002"]) {
    const ours = JSON.parse(JSON.stringify(await loadReadings(tsWs, id)));
    const theirs = JSON.parse(JSON.stringify(await loadReadings(pyWs, id)));
    const diff = ours.map(mask).find((s: any, i: number) => !isDeepStrictEqual(s, mask(theirs[i])));
    check(`${id}: every suggestion matches Python's (levels, evidence and offsets, notes, the call's approvals)`, !diff && ours.length === theirs.length, (JSON.stringify(diff) ?? "").slice(0, 400));
    check(`${id}: Python loads this core's suggestions`, isDeepStrictEqual(pyResult.ts_loaded[id], ours));
  }
  const logs = (p: string) => readdirSync(join(p, "readings", "runs")).map((f) => JSON.parse(readFileSync(join(p, "readings", "runs", f), "utf8")));
  const [ourLog] = logs(tsPath);
  const [theirLog] = logs(pyPath);
  const keep = (l: any) => ({ ...l, estimated_usd: "-", calls: l.calls.map((c: any) => ({ ...c })) });
  check("the run logs match Python's (except the estimate, which here includes the output schema)", isDeepStrictEqual(keep(ourLog), keep(theirLog)), JSON.stringify(ourLog).slice(0, 300) + " / " + JSON.stringify(theirLog).slice(0, 300));
  check("the estimate here is at least Python's", ourLog.estimated_usd >= theirLog.estimated_usd);
} finally {
  rmSync(root, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
