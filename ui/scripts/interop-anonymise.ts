/**
 * Two-way check with Python for anonymisation and the gate. The same
 * request, originals and rules go into two workspaces; the TypeScript core
 * anonymises one and Python the other, with the same clock, and the records
 * must match. Then each side reads the other's: Python's gate passes the
 * text this core approved, this core's gate passes Python's approvals, and a
 * brief Python imported is anonymised and approved here and read there.
 *
 *   node scripts/interop-anonymise.ts      (needs uv and the core environment)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  anonymiseWorkspace,
  approve,
  approvedBriefText,
  approvedText,
  bytesSource,
  createWorkspace,
  importOriginals,
  loadRules,
  loadSubmission,
  openWorkspace,
  recordRequest,
  requireApproved,
  reviewLines,
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

const NOW = "2026-09-27T10:15:30.123Z";
const FILES: [string, string, string, string][] = [
  ["sub-a", "100200301", "QUILL AVERY .", "docx"],
  ["sub-b", "100200302", "PIKE JORDAN", "pdf"],
];
const RULES = { names: ["Sam", "Morgan Ellis"], organisations: ["Northwind Widgets Ltd", "Fabrikam Games"], redact: { MoSCoW: "REDACTED" }, ignore: ["20260115"] };

try {
  const zip = join(root, "originals_1.zip");
  writeFileSync(zip, makeZip(Object.fromEntries(FILES.map(([sid, ext, who, fmt]) => [`${ext} - ${who} - report.${fmt}`, packFile(`submissions/${sid}.${fmt}`)]))));
  const open = async (name: string): Promise<[Workspace, string]> => {
    const registration = await createWorkspace(client, join(root, name), { retention_days: 45, retention_source: "terms" });
    return [await openWorkspace(new NodeFileSystem(registration.path), client), registration.path];
  };
  const [tsWs, tsPath] = await open("by-typescript");
  const [, pyPath] = await open("by-python");
  const now = new Date(NOW);

  // 1. The same inputs and rules, anonymised by each core.
  await recordRequest(tsWs, FILES.map(([, ext]) => ({ external_id: ext })), { now });
  await importOriginals(tsWs, bytesSource("originals_1.zip", new Uint8Array(readFileSync(zip))), { now });
  await updateRules(tsWs, RULES);
  const tsResult = await anonymiseWorkspace(tsWs, { now });
  const pyResult = python(`
import json
from datetime import datetime
from pathlib import Path
from feedbacker_core.anonymise import anonymise_workspace, update_rules
from feedbacker_core.brief import import_brief
from feedbacker_core.originals import import_originals
from feedbacker_core.request import SampleEntry, record_request
from feedbacker_core.workspace import Workspace
now = datetime.fromisoformat(${JSON.stringify(NOW)})
ws = Workspace.open(Path(${JSON.stringify(pyPath)}))
record_request(ws, [SampleEntry(e) for e in ${JSON.stringify(FILES.map(([, ext]) => ext))}], now=now)
import_originals(ws, Path(${JSON.stringify(zip)}), now=now)
update_rules(ws, **json.loads(${JSON.stringify(JSON.stringify(RULES))}))
result = anonymise_workspace(ws, now=now)
print(json.dumps({"counts": {k: dict(v) for k, v in result.counts.items()}, "kept": result.approval_kept}))
`);
  check("both cores count the same redactions", isDeepStrictEqual({ counts: tsResult.counts, kept: tsResult.approvalKept }, pyResult), JSON.stringify(pyResult));
  const pyWs = await openWorkspace(new NodeFileSystem(pyPath), client);
  for (const id of ["sub-001", "sub-002"]) {
    const [ours, theirs] = [await loadSubmission(tsWs, id), await loadSubmission(pyWs, id)];
    check(`${id}: the anonymised text, redactions and provenance match Python's`, isDeepStrictEqual(ours.anonymised, theirs.anonymised));
  }
  check("the pseudonym keys (names and tokens) match Python's", isDeepStrictEqual(await tsWs.readKey(), await pyWs.readKey()));
  check("Python's rules file reads the same as this core's", isDeepStrictEqual(await loadRules(pyWs), await loadRules(tsWs)));

  // 2. This core approves; Python's gate reads it.
  await approve(tsWs, "sub-001", now);
  const gate = python(`
import json
from pathlib import Path
from feedbacker_core.anonymise import load_rules, review_lines
from feedbacker_core.boundary import UnapprovedText, approved_text, require_approved
from feedbacker_core.workspace import Workspace
ws = Workspace.open(Path(${JSON.stringify(tsPath)}))
text, approval = approved_text(ws, "sub-001")
require_approved(ws, "sub-001", text)
try:
    approved_text(ws, "sub-002"); refused = False
except UnapprovedText: refused = True
print(json.dumps({"text": text, "approval": approval.model_dump(mode="json"), "refused": refused, "review": review_lines(ws, "sub-001", True), "rules": load_rules(ws).model_dump()}))
`);
  const [text, approval] = await approvedText(tsWs, "sub-001");
  check("Python's gate passes the text this core approved", gate.text === text && isDeepStrictEqual(gate.approval, JSON.parse(JSON.stringify(approval))));
  check("Python's gate refuses what this core hasn't approved", gate.refused);
  const ourReview = await reviewLines(tsWs, "sub-001", true);
  check("Python's review lines for this core's record match this core's", isDeepStrictEqual(gate.review, ourReview));
  check("Python reads the rules this core wrote", isDeepStrictEqual(gate.rules, JSON.parse(JSON.stringify(await loadRules(tsWs)))));

  // 3. Python approves and imports a brief; this core reads, reruns, and approves the brief.
  python(`
from datetime import datetime
from pathlib import Path
from feedbacker_core.anonymise import approve
from feedbacker_core.brief import import_brief
from feedbacker_core.workspace import Workspace
ws = Workspace.open(Path(${JSON.stringify(pyPath)}))
approve(ws, "sub-002", now=datetime.fromisoformat(${JSON.stringify(NOW)}))
import_brief(ws, Path(${JSON.stringify(new URL("brief.docx", PACK).pathname)}))
`);
  const [pyText] = await approvedText(pyWs, "sub-002");
  check("this core's gate passes Python's approval", (await requireApproved(pyWs, "sub-002", pyText)).approved_by.kind === "moderator");
  const rerun = await anonymiseWorkspace(pyWs, { now });
  check("rerunning here keeps Python's approval of unchanged text", rerun.approvalKept["sub-002"] === true && "brief" in rerun.counts);
  await approve(pyWs, "brief", now);
  const [briefText] = await approvedBriefText(pyWs);
  const briefGate = python(`
import json
from pathlib import Path
from feedbacker_core.boundary import approved_brief_text, require_approved_brief
from feedbacker_core.workspace import Workspace
ws = Workspace.open(Path(${JSON.stringify(pyPath)}))
text, approval = approved_brief_text(ws)
require_approved_brief(ws, text)
print(json.dumps({"text": text}))
`);
  check("Python's gate passes the brief this core anonymised and approved", briefGate.text === briefText && !briefText.includes("Morgan Ellis"));
} finally {
  rmSync(root, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
