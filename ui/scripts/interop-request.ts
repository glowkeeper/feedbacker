/**
 * Two-way check with Python for requests and originals (#48). The same
 * request and the same bulk downloads are recorded and imported twice, once
 * by the TypeScript core and once by Python's core, each into its own
 * workspace, with the same clock. Each side then loads what the other wrote
 * (`load_request`, `load_submission`, and their ports), and the records are
 * compared field by field.
 *
 *   node scripts/interop-request.ts      (needs uv and the core environment)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  bytesSource,
  createWorkspace,
  importOriginals,
  loadRequest,
  loadSubmission,
  openWorkspace,
  recordRequest,
  type Workspace,
} from "../src/core/index.ts";
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
/** The first differing path between two JSON values, for a readable failure. */
function firstDifference(a: unknown, b: unknown, at = ""): string {
  if (isDeepStrictEqual(a, b)) return "";
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${at}.${k}`);
      if (d) return d;
    }
  }
  return `${at || "."}: ${JSON.stringify(a)?.slice(0, 120)} != ${JSON.stringify(b)?.slice(0, 120)}`;
}

const NOW = "2026-09-26T10:15:30.123Z"; // milliseconds: a Date holds no finer
const SAMPLE = [
  { external_id: "100200301", band: "70-79: First" },
  { external_id: " 100200302 " },
  { external_id: "100200303", band: "40-49" },
];
const OPTIONS = {
  programme: "Fictional BSc",
  module: "  Fictional Module 101 ",
  staff_roles: ["module leader", "second marker"],
  cohort_size: 40,
  multiple_groups: false,
  band_distribution: [
    { label: "70-79: First", count: 6 },
    { label: "40-49", count: 9 },
  ],
  sample_note: "Selected by the module leader.",
};

try {
  // The same downloads on disk for both sides: a main zip (with a corrupt,
  // unsampled member that must never be opened) and a late single file.
  const main = join(root, "main_1.zip");
  const late = join(root, "100200303 - MARSH RILEY - late report.pdf");
  writeFileSync(
    main,
    makeZip({
      "Quill_Avery_100200301_report.docx": packFile("submissions/sub-a.docx"),
      "Pike_Jordan_100200302_report.pdf": packFile("submissions/sub-b.pdf"),
      "Other_Student_100200399_report.docx": "corrupt and never opened",
    }),
  );
  writeFileSync(late, packFile("marked-view-replica.pdf")); // unsuitable: fails alone

  const open = async (name: string): Promise<Workspace> => {
    const registration = await createWorkspace(client, join(root, name), { retention_days: 45, retention_source: "terms" });
    return openWorkspace(new NodeFileSystem(registration.path), client);
  };
  const tsWs = await open("by-typescript");
  await open("by-python");

  // 1. TypeScript records and imports into its workspace.
  const now = new Date(NOW);
  await recordRequest(tsWs, SAMPLE, { ...OPTIONS, now });
  const tsResult = await importOriginals(
    tsWs,
    [bytesSource("main_1.zip", readFileSync(main)), bytesSource("100200303 - MARSH RILEY - late report.pdf", readFileSync(late))],
    { now },
  );

  // 2. Python records and imports into its workspace, and loads both.
  const py = JSON.parse(
    python(`
import json
from datetime import datetime
from pathlib import Path
from feedbacker_core.models import BandCount
from feedbacker_core.originals import import_originals, load_submission
from feedbacker_core.request import SampleEntry, load_request, record_request
from feedbacker_core.workspace import Workspace

now = datetime.fromisoformat(${JSON.stringify(NOW)})
options = json.loads(${JSON.stringify(JSON.stringify(OPTIONS))})
options["band_distribution"] = [BandCount(**b) for b in options["band_distribution"]]
sample = [SampleEntry(**s) for s in json.loads(${JSON.stringify(JSON.stringify(SAMPLE))})]
ws = Workspace.open(Path(${JSON.stringify(join(root, "by-python"))}))
record_request(ws, sample, now=now, **options)
result = import_originals(ws, [Path(${JSON.stringify(main)}), Path(${JSON.stringify(late)})], now=now)

def dump(ws):
    return {
        "request": load_request(ws).model_dump(mode="json"),
        "key": ws.read_key().model_dump(mode="json"),
        "submissions": {s.submission_id: load_submission(ws, s.submission_id).model_dump(mode="json")
                        for s in load_request(ws).sample if ws.exists(f"submissions/{s.submission_id}.json")},
    }

theirs = Workspace.open(Path(${JSON.stringify(join(root, "by-typescript"))}))
print(json.dumps({
    "result": {"imported": [s.id for s in result.imported], "failed": result.failed, "ignored": result.ignored_count},
    "own": dump(ws),
    "typescript": dump(theirs),
}))
`),
  );

  // 3. The TypeScript core loads Python's workspace, and its own.
  const dump = async (ws: Workspace) => {
    const request = await loadRequest(ws);
    const submissions: Record<string, unknown> = {};
    for (const s of request.sample) {
      if (await ws.exists(`submissions/${s.submission_id}.json`)) submissions[s.submission_id] = await loadSubmission(ws, s.submission_id);
    }
    return JSON.parse(JSON.stringify({ request, key: await ws.readKey(), submissions }));
  };
  const tsOwn = await dump(tsWs);
  const tsReadsPython = await dump(await openWorkspace(new NodeFileSystem(join(root, "by-python")), client));

  const tsSummary = { imported: tsResult.imported.map((s) => s.id), failed: Object.fromEntries(tsResult.failed), ignored: tsResult.ignoredCount };
  check("both import the same submissions and fail the same one", isDeepStrictEqual(tsSummary, py.result), firstDifference(tsSummary, py.result));
  check("Python loads the request and submissions the TypeScript core wrote", isDeepStrictEqual(py.typescript, tsOwn), firstDifference(py.typescript, tsOwn));
  check("the TypeScript core loads the request and submissions Python wrote", isDeepStrictEqual(tsReadsPython, py.own), firstDifference(tsReadsPython, py.own));
  check("the requests are identical", isDeepStrictEqual(tsOwn.request, py.own.request), firstDifference(tsOwn.request, py.own.request));
  check("the pseudonym keys are identical", isDeepStrictEqual(tsOwn.key, py.own.key), firstDifference(tsOwn.key, py.own.key));
  check(
    "the submission records are identical",
    isDeepStrictEqual(tsOwn.submissions, py.own.submissions) && Object.keys(tsOwn.submissions).length === 2,
    firstDifference(tsOwn.submissions, py.own.submissions),
  );
  const stored = (side: string, id: string, ext: string) => readFileSync(join(root, side, "sources", "originals", `${id}.${ext}`));
  check(
    "the stored originals are byte-identical",
    stored("by-typescript", "sub-001", "docx").equals(stored("by-python", "sub-001", "docx")) &&
      stored("by-typescript", "sub-002", "pdf").equals(stored("by-python", "sub-002", "pdf")),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
