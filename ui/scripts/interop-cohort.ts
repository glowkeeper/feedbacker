/**
 * Cohort import parity with the Python command line: both cores import the
 * same synthetic bulk download into a marking workspace, and must record the
 * same cohort, pseudonym key and submissions, and leave the same files out.
 * Then Python lists, anonymises and approves the cohort the TypeScript core
 * imported, and the TypeScript core reads what Python wrote.
 *
 *   node scripts/interop-cohort.ts      (needs uv and the core environment)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { bytesSource, createWorkspace, idFromFileName, importCohort, loadCohort, loadSubmission, openWorkspace } from "../src/core/index.ts";
import { makeZip, packFile } from "../test/builders.ts";
import { NodeFileSystem } from "../test/nodeFileSystem.ts";
import { realProxy, tempDir } from "../test/proxyHarness.ts";

const python = (code: string) =>
  execFileSync("uv", ["run", "--quiet", "--project", "../core", "python", "-c", code], { encoding: "utf8" }).trim();

const { client } = realProxy();
const root = tempDir();
let failures = 0;
const check = (what: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`);
};

const sub = (name: string) => packFile(`submissions/${name}`);

try {
  // A synthetic download: Turnitin-style names, a Canvas-style late file, the platform's report, an ID in two files, and stray files.
  const zipPath = join(root, "cohort_1.zip");
  writeFileSync(
    zipPath,
    makeZip({
      "100200301 - QUILL AVERY . - report.docx": sub("sub-a.docx"),
      "100200302 - PIKE JORDAN - report.pdf": sub("sub-b.pdf"),
      "100200303 - MARSH RILEY - report.docx": sub("sub-c.docx"),
      "100200303 - MARSH RILEY - report v2.docx": sub("sub-c.docx"),
      "100200305 - ROWAN CASEY - slides.pptx": "never opened",
      "manifest.txt": "The requested files are now available",
      "notes from the marker.docx": "never opened",
    }),
  );
  const latePath = join(root, "rowancasey_late_4024_77034_report.pdf");
  writeFileSync(latePath, sub("sub-d.pdf"));

  const names = ["100200301 - QUILL AVERY . - report.docx.pdf", "pikejordan_late_4021_77031_report.docx", "Quill_Avery_100200301_report.docx", "report 2024.docx", "12 - x - y", "a_123_456_z"];
  const pyIds = JSON.parse(
    python(`
import json
from feedbacker_core.cohort import id_from_file_name
print(json.dumps([id_from_file_name(n) for n in ${JSON.stringify(names)}]))
`),
  );
  check("both cores read the same IDs from file names", isDeepStrictEqual(pyIds, names.map(idFromFileName)), JSON.stringify(pyIds));

  // The TypeScript core imports into one marking workspace; Python into another. Both take three: the ID in two files and
  // the pptx are left out.
  const registration = await createWorkspace(client, join(root, "mark-ts"), { workspace_type: "marking" });
  const ws = await openWorkspace(new NodeFileSystem(registration.path), client);
  const sources = [bytesSource("cohort_1.zip", readFileSync(zipPath)), bytesSource("rowancasey_late_4024_77034_report.pdf", readFileSync(latePath))];
  const ts = await importCohort(ws, sources, { now: new Date("2026-01-15T09:00:00Z") });
  const py = JSON.parse(
    python(`
import json
from datetime import UTC, datetime
from pathlib import Path
from feedbacker_core.cohort import import_cohort, load_cohort
from feedbacker_core.originals import load_submission
from feedbacker_core.workspace import Workspace
ws = Workspace.create("mark-py", root=Path(${JSON.stringify(root)}), workspace_type="marking")
r = import_cohort(ws, [Path(${JSON.stringify(zipPath)}), Path(${JSON.stringify(latePath)})], now=datetime(2026, 1, 15, 9, tzinfo=UTC))
cohort = load_cohort(ws)
print(json.dumps({
  "imported": [s.id for s in r.imported], "kept": r.kept, "failed": r.failed, "not_imported": r.not_imported, "ignored": r.ignored_count,
  "cohort": cohort.model_dump(mode="json"),
  "key": [e.model_dump(mode="json") for e in ws.read_key().entries],
  "texts": {s.submission_id: load_submission(ws, s.submission_id).extract.text for s in cohort.submissions},
}))
`),
  );
  check("both cores import the same submissions", isDeepStrictEqual(py.imported, ts.imported.map((s) => s.id)), JSON.stringify(py.imported));
  check(
    "both cores leave the same files out, described the same way",
    isDeepStrictEqual([py.not_imported, py.ignored, py.kept, py.failed], [ts.notImported, ts.ignoredCount, ts.kept, Object.fromEntries(ts.failed)]),
    JSON.stringify(py.not_imported),
  );
  check("both cores record the same cohort", isDeepStrictEqual(py.cohort, await loadCohort(ws)), JSON.stringify(py.cohort.submissions));
  check("both cores record the same pseudonym key", isDeepStrictEqual(py.key, (await ws.readKey()).entries), JSON.stringify(py.key.map((e: { pseudonym: string }) => e.pseudonym)));
  const tsTexts = Object.fromEntries(await Promise.all(Object.keys(py.texts).map(async (id) => [id, (await loadSubmission(ws, id)).extract!.text])));
  check("both cores extract the same text from each submission", isDeepStrictEqual(py.texts, tsTexts));

  // Python works from the cohort the TypeScript core imported; the TypeScript core reads what Python wrote.
  const anonymised = JSON.parse(
    python(`
import json
from pathlib import Path
from feedbacker_core.anonymise import anonymise_workspace, approve
from feedbacker_core.cohort import list_submissions
from feedbacker_core.workspace import Workspace
ws = Workspace.open(Path(${JSON.stringify(registration.path)}))
listed = [s.submission_id for s in list_submissions(ws)]
result = anonymise_workspace(ws)
approval = approve(ws, "sub-001")
print(json.dumps({"listed": listed, "anonymised": sorted(result.counts), "by": approval.approved_by.kind}))
`),
  );
  check("Python lists the cohort the TypeScript core imported", isDeepStrictEqual(anonymised.listed, ["sub-001", "sub-002", "sub-003"]), JSON.stringify(anonymised.listed));
  check("Python anonymises the cohort, and the educator approves", isDeepStrictEqual([anonymised.anonymised, anonymised.by], [["sub-001", "sub-002", "sub-003"], "educator"]));
  const back = await loadSubmission(ws, "sub-001");
  check("the TypeScript core reads Python's anonymised text and the educator's approval", back.approval?.approved_by.kind === "educator" && back.approval.approved_text_sha256 === back.anonymised?.text_sha256);
} finally {
  rmSync(root, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
