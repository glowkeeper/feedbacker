/**
 * Two-way check with the Python command line (#46): a workspace created and
 * written by the TypeScript core (through the real proxy code) is opened and
 * read by Python's `Workspace`, and what Python then writes is read back by
 * the TypeScript core.
 *
 *   node scripts/interop-workspace.ts      (needs uv and the core environment)
 */

import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createWorkspace, openWorkspace, PseudonymKey } from "../src/core/index.ts";
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

try {
  // 1. TypeScript creates and writes; Python reads.
  const registration = await createWorkspace(client, join(root, "mod-1"), { retention_days: 45, retention_source: "terms" });
  const fs = new NodeFileSystem(registration.path);
  const ws = await openWorkspace(fs, client);
  const key = PseudonymKey.parse({
    entries: [{ submission_id: "sub-001", pseudonym: "[STUDENT_A]", external_id: "100200300", names: ["PIKE JORDAN"] }],
    tokens: [{ token: "[ORG_1]", kind: "ORG", value: "Straße GmbH" }],
  });
  await ws.writeKey(key);
  await ws.writeJson("notes.json", { note: "Zoë 🙂", n: 1.5 });

  const fromPython = JSON.parse(
    python(`
import json
from pathlib import Path
from feedbacker_core.workspace import Workspace
ws = Workspace.open(Path(${JSON.stringify(registration.path)}))
print(json.dumps({"manifest": ws.manifest.model_dump(mode="json"), "key": ws.read_key().model_dump(mode="json"), "notes": ws.read_json("notes.json")}))
`),
  );
  check("Python opens a workspace the TypeScript core created", fromPython.manifest.name === "mod-1" && fromPython.manifest.retention_days === 45);
  check("Python reads the pseudonym key the TypeScript core wrote", isDeepStrictEqual(fromPython.key, key), JSON.stringify(fromPython.key));
  check("Python reads a record the TypeScript core wrote", isDeepStrictEqual(fromPython.notes, { note: "Zoë 🙂", n: 1.5 }));

  // 2. Python writes; TypeScript reads.
  python(`
from pathlib import Path
from feedbacker_core.workspace import KeyEntry, Workspace
ws = Workspace.open(Path(${JSON.stringify(registration.path)}))
key = ws.read_key()
ws.write_key(key.with_entries([*key.entries, KeyEntry(submission_id="sub-002", pseudonym="[STUDENT_B]", external_id="100200301")]))
ws.write_json("from-python.json", {"written_by": "python", "text": "naïve"})
`);
  const reopened = await openWorkspace(fs, client);
  const keyBack = await reopened.readKey();
  check(
    "the TypeScript core reads the key Python extended",
    keyBack.entries.map((e) => e.pseudonym).join() === "[STUDENT_A],[STUDENT_B]" && keyBack.tokens[0].value === "Straße GmbH",
  );
  check("the TypeScript core reads a record Python wrote", isDeepStrictEqual(await reopened.readJson("from-python.json"), { written_by: "python", text: "naïve" }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
