/**
 * Two-way check with Python for the brief. The same brief is imported
 * by each core, with the same clock, and the records must match. Python then
 * loads, anonymises and approves the brief this core imported, and this
 * core's gate passes it; and this core replaces a brief Python imported,
 * which Python then loads.
 *
 *   node scripts/interop-brief.ts      (needs uv and the core environment)
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { approvedBriefText, bytesSource, createWorkspace, importBrief, loadBrief, openWorkspace, recordRequest, requireApprovedBrief, type Workspace } from "../src/core/index.ts";
import { PACK, pdfPages } from "../test/builders.ts";
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
const NOW = "2026-09-27T11:00:00.000Z";
const BRIEF_PATH = new URL("brief.docx", PACK).pathname;

try {
  const open = async (name: string): Promise<[Workspace, string]> => {
    const registration = await createWorkspace(client, join(root, name), { retention_days: 45, retention_source: "terms" });
    return [await openWorkspace(new NodeFileSystem(registration.path), client), registration.path];
  };
  const [tsWs, tsPath] = await open("by-typescript");
  const [, pyPath] = await open("by-python");
  const now = new Date(NOW);

  // 1. Each core imports the same brief.
  await recordRequest(tsWs, [{ external_id: "100200301" }], { now });
  const ours = await importBrief(tsWs, bytesSource("brief.docx", new Uint8Array(readFileSync(BRIEF_PATH))), { now });
  const theirs = python(`
import json
from datetime import datetime
from pathlib import Path
from feedbacker_core.brief import import_brief
from feedbacker_core.request import SampleEntry, record_request
from feedbacker_core.workspace import Workspace
now = datetime.fromisoformat(${JSON.stringify(NOW)})
ws = Workspace.open(Path(${JSON.stringify(pyPath)}))
record_request(ws, [SampleEntry("100200301")], now=now)
print(json.dumps(import_brief(ws, Path(${JSON.stringify(BRIEF_PATH)}), now=now).model_dump(mode="json")))
`);
  check("both cores import the same brief record", isDeepStrictEqual(JSON.parse(JSON.stringify(ours)), theirs));
  check("both store the source under the same name", isDeepStrictEqual(readdirSync(join(tsPath, "sources")), readdirSync(join(pyPath, "sources"))));

  // 2. Python loads, anonymises and approves this core's brief; this core's gate passes it.
  const approved = python(`
import json
from pathlib import Path
from feedbacker_core.anonymise import anonymise_workspace, approve, update_rules
from feedbacker_core.boundary import approved_brief_text
from feedbacker_core.brief import load_brief
from feedbacker_core.workspace import Workspace
ws = Workspace.open(Path(${JSON.stringify(tsPath)}))
load_brief(ws)
update_rules(ws, names=["Morgan Ellis"])
anonymise_workspace(ws)
approve(ws, "brief")
print(json.dumps(approved_brief_text(ws)[0]))
`);
  const [text] = await approvedBriefText(tsWs);
  check("this core's gate passes the brief Python anonymised and approved", text === approved && !text.includes("Ellis") && (await requireApprovedBrief(tsWs, text)).approved_by.kind === "moderator");

  // 3. This core replaces Python's brief; Python loads the new one.
  const pyWs = await openWorkspace(new NodeFileSystem(pyPath), client);
  const replaced = await importBrief(pyWs, bytesSource("new.pdf", pdfPages(["A different fictional brief."])), { replace: true, now });
  const loaded = python(`
import json
from pathlib import Path
from feedbacker_core.brief import load_brief
from feedbacker_core.workspace import Workspace
print(json.dumps(load_brief(Workspace.open(Path(${JSON.stringify(pyPath)}))).model_dump(mode="json")))
`);
  check("Python loads the brief this core put in place of its own", isDeepStrictEqual(loaded, JSON.parse(JSON.stringify(replaced))));
  check("and only the new source is left", isDeepStrictEqual(readdirSync(join(pyPath, "sources")), [`brief-${replaced.source_sha256.slice(0, 16)}.pdf`]));
  check("this core loads it too", isDeepStrictEqual(await loadBrief(pyWs), replaced));
} finally {
  rmSync(root, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
