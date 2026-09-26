/**
 * Two-way check with Python for rubrics (#49): a rubric the TypeScript core
 * imports into a workspace is loaded by Python's `load_rubric` (as marking
 * does), and one Python imports is read back by the TypeScript core, which
 * then refuses to overwrite it without `replace`.
 *
 *   node scripts/interop-rubric.ts      (needs uv and the core environment)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { bytesSource, createWorkspace, importRubric, openWorkspace, Rubric, RUBRIC, RUBRIC_WARNINGS } from "../src/core/index.ts";
import { PACK } from "../test/builders.ts";
import { NodeFileSystem } from "../test/nodeFileSystem.ts";
import { realProxy, tempDir } from "../test/proxyHarness.ts";

const python = (code: string) =>
  execFileSync("uv", ["run", "--quiet", "--project", "../core", "python", "-c", code], { encoding: "utf8" }).trim();

const { client } = realProxy();
const root = tempDir();
let failures = 0;
const check = (what: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${!ok && detail ? `: ${detail}` : ""}`);
};
const pack = (name: string) => bytesSource(name, new Uint8Array(readFileSync(new URL(name, PACK))));

try {
  const registration = await createWorkspace(client, join(root, "mod-1"), { retention_days: 45, retention_source: "terms" });
  const ws = await openWorkspace(new NodeFileSystem(registration.path), client);

  // 1. TypeScript imports; Python loads.
  const { rubric, warnings } = await importRubric(ws, pack("rubric.csv"), { title: "Synthetic rubric" });
  const loaded = JSON.parse(
    python(`
import json
from pathlib import Path
from feedbacker_core.marking import load_rubric
from feedbacker_core.workspace import Workspace
ws = Workspace.open(Path(${JSON.stringify(registration.path)}))
print(json.dumps({"rubric": load_rubric(ws).model_dump(mode="json"), "warnings": ws.read_json("rubric-warnings.json")}))
`),
  );
  check("Python's load_rubric reads the rubric the TypeScript core imported", isDeepStrictEqual(loaded.rubric, JSON.parse(JSON.stringify(rubric))));
  check("Python reads the import warnings the TypeScript core wrote", isDeepStrictEqual(loaded.warnings, warnings) && warnings.length === 1);

  // 2. Python imports a grid (confirmed); TypeScript reads it.
  const fromPython = JSON.parse(
    python(`
import json
from pathlib import Path
from feedbacker_core.rubric_import import import_rubric
from feedbacker_core.workspace import Workspace
ws = Workspace.open(Path(${JSON.stringify(registration.path)}))
rubric, warnings, written = import_rubric(ws, Path(${JSON.stringify(new URL("rubric-grid.xlsx", PACK).pathname)}), title="Grid", confirm=True, replace=True, weights={"implementation": 25})
print(json.dumps({"rubric": rubric.model_dump(mode="json"), "written": written}))
`),
  );
  const read = Rubric.parse(await ws.readJson(RUBRIC));
  check("the TypeScript core reads the rubric Python imported", fromPython.written && isDeepStrictEqual(JSON.parse(JSON.stringify(read)), fromPython.rubric));
  check("the TypeScript core reads the warnings Python wrote", isDeepStrictEqual(await ws.readJson(RUBRIC_WARNINGS), []));
  const refused = await importRubric(ws, pack("rubric.csv")).then(() => false, (err: Error) => err.message.includes("already imported"));
  check("the TypeScript core won't overwrite Python's rubric without replace", refused);
} finally {
  rmSync(root, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
