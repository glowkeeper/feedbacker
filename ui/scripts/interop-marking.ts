/**
 * Two-way check with Python for marking. The same request, rubric,
 * rules and bulk download of marked views go into two workspaces; the
 * TypeScript core imports into one and Python into the other, with the same
 * clock and an explicit criterion mapping, and the records, keys, criteria
 * maps and history must match. Then each side confirms, corrects or reads
 * the other's.
 *
 *   node scripts/interop-marking.ts      (needs uv and the core environment)
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  bytesSource,
  confirmMarking,
  createWorkspace,
  enterMarking,
  importMarking,
  importRubric,
  loadCriteriaMap,
  loadMarking,
  markingSummary,
  openWorkspace,
  recordRequest,
  updateRules,
  type Workspace,
} from "../src/core/index.ts";
import { makeZip, PACK, packFile } from "../test/builders.ts";
import { NodeFileSystem } from "../test/nodeFileSystem.ts";
import { realProxy, tempDir } from "../test/proxyHarness.ts";

const python = (code: string) =>
  JSON.parse(execFileSync("uv", ["run", "--quiet", "--project", "../core", "python", "-c", code], { encoding: "utf8" }).trim() || "null");

const { client } = realProxy();
const root = tempDir();
let failures = 0;
const check = (what: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${!ok && detail ? `: ${detail}` : ""}`);
};
const NOW = "2026-09-27T12:00:00.123Z";
const MAPPING = { PROFESSIONALISM: "reflection-and-professional-practice" };

try {
  const zip = join(root, "grademark_1.zip");
  writeFileSync(
    zip,
    makeZip({
      "100200302 - PIKE JORDAN - Study_Buddy.docx.pdf": packFile("marked-view-replica.pdf"),
      "100200399 - OTHER STUDENT - x.docx.pdf": "never opened",
      "download_report.txt": "Number of files requested: 2\nFailed file count: 1\n",
    }),
  );
  const open = async (name: string): Promise<[Workspace, string]> => {
    const registration = await createWorkspace(client, join(root, name), { retention_days: 45, retention_source: "terms" });
    return [await openWorkspace(new NodeFileSystem(registration.path), client), registration.path];
  };
  const [tsWs, tsPath] = await open("by-typescript");
  const [, pyPath] = await open("by-python");
  const now = new Date(NOW);

  // 1. The same inputs, imported by each core.
  await recordRequest(tsWs, [{ external_id: "100200302" }], { now });
  await importRubric(tsWs, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic", now });
  await updateRules(tsWs, { names: ["Sam"] });
  const ours = await importMarking(tsWs, bytesSource("grademark_1.zip", new Uint8Array(readFileSync(zip))), { criteria: MAPPING, now });
  await importMarking(tsWs, bytesSource("grademark_1.zip", new Uint8Array(readFileSync(zip))), { replace: true, now: new Date("2026-09-27T12:30:00.000Z") });
  const theirs = python(`
import json
from datetime import datetime
from pathlib import Path
from feedbacker_core.anonymise import update_rules
from feedbacker_core.marking import import_marking
from feedbacker_core.request import SampleEntry, record_request
from feedbacker_core.rubric_import import import_rubric
from feedbacker_core.workspace import Workspace
now = datetime.fromisoformat(${JSON.stringify(NOW)})
ws = Workspace.open(Path(${JSON.stringify(pyPath)}))
record_request(ws, [SampleEntry("100200302")], now=now)
import_rubric(ws, Path(${JSON.stringify(new URL("rubric.csv", PACK).pathname)}), title="Synthetic", now=now)
update_rules(ws, names=["Sam"])
r = import_marking(ws, Path(${JSON.stringify(zip)}), criteria=json.loads(${JSON.stringify(JSON.stringify(MAPPING))}), now=now)
import_marking(ws, Path(${JSON.stringify(zip)}), replace=True, now=datetime.fromisoformat("2026-09-27T12:30:00.000Z"))
print(json.dumps({"failed": r.failed, "ignored": r.ignored_count, "warnings": r.download_warnings, "unmapped": sorted(r.unmapped), "ids": r.source_ids}))
`);
  check(
    "both import the same sample, and report the same download warnings",
    isDeepStrictEqual({ failed: Object.fromEntries(ours.failed), ignored: ours.ignoredCount, warnings: ours.downloadWarnings, unmapped: [...ours.unmapped].sort(), ids: ours.sourceIds }, theirs),
    JSON.stringify(theirs),
  );
  const pyWs = await openWorkspace(new NodeFileSystem(pyPath), client);
  check("the marking records match Python's", isDeepStrictEqual(await loadMarking(tsWs, "sub-001"), await loadMarking(pyWs, "sub-001")));
  check("the pseudonym keys match Python's", isDeepStrictEqual(await tsWs.readKey(), await pyWs.readKey()));
  check("the criteria maps match Python's", isDeepStrictEqual(await loadCriteriaMap(tsWs), await loadCriteriaMap(pyWs)));
  check("the history has the same file, with the same record", isDeepStrictEqual(readdirSync(join(tsPath, "marking", "history")), readdirSync(join(pyPath, "marking", "history"))) &&
    isDeepStrictEqual(await tsWs.readJson(`marking/history/${readdirSync(join(tsPath, "marking", "history"))[0]}`), await pyWs.readJson(`marking/history/${readdirSync(join(pyPath, "marking", "history"))[0]}`)));
  check("the stored marked views are identical", readFileSync(join(tsPath, "sources", "marked", "sub-001.pdf")).equals(readFileSync(join(pyPath, "sources", "marked", "sub-001.pdf"))));

  // 2. Python confirms and summarises this core's record, and enters a correction; this core reads them.
  const summary = python(`
import json
from datetime import datetime
from pathlib import Path
from feedbacker_core.marking import confirm_marking, enter_marking, marking_summary
from feedbacker_core.workspace import Workspace
ws = Workspace.open(Path(${JSON.stringify(tsPath)}))
confirm_marking(ws, "sub-001", now=datetime.fromisoformat(${JSON.stringify(NOW)}))
lines = marking_summary(ws, "sub-001")
enter_marking(ws, "sub-001", marker_label="agreed", overall=59, criteria={"implementation": 58}, comment="Jordan's app works.", now=datetime.fromisoformat(${JSON.stringify(NOW)}))
print(json.dumps(lines))
`);
  check("Python's summary of this core's record matches this core's", isDeepStrictEqual(summary, await markingSummary(tsWs, "sub-001")));
  check("this core reads the confirmation Python recorded", (await loadMarking(tsWs, "sub-001")).confirmed_by?.kind === "moderator");
  const agreed = await loadMarking(tsWs, "sub-001", "agreed");
  check("this core reads the correction Python entered, with its comment anonymised", agreed.import_route === "manual" && agreed.overall_comment === "[STUDENT_A]'s app works.");

  // 3. This core confirms and enters in Python's workspace; Python reads them.
  await confirmMarking(pyWs, "sub-001", "marker", now);
  await enterMarking(pyWs, "sub-001", { markerLabel: "agreed", overall: 59, criteria: { implementation: 58 }, comment: "Jordan's app works.", now });
  const read = python(`
import json
from pathlib import Path
from feedbacker_core.marking import load_marking, marking_summary
from feedbacker_core.workspace import Workspace
ws = Workspace.open(Path(${JSON.stringify(pyPath)}))
print(json.dumps({"agreed": load_marking(ws, "sub-001", "agreed").model_dump(mode="json"), "summary": marking_summary(ws, "sub-001", "agreed")}))
`);
  check("Python reads the correction this core entered", isDeepStrictEqual(read.agreed, JSON.parse(JSON.stringify(agreed))));
  check("Python's summary of it matches this core's", isDeepStrictEqual(read.summary, await markingSummary(pyWs, "sub-001", "agreed")));
} finally {
  rmSync(root, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
