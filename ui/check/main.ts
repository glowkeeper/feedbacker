/**
 * The workspace in a real browser (#46), on the origin private file system,
 * which gives the same folder handles as the folder picker without needing a
 * person to click. Step 1 opens and writes a workspace and remembers its
 * handle; step 2 (after a reload) recalls the handle, reads back, and deletes.
 */

import "../src/platform/pdfWorker.ts";
import { openWorkspace, PseudonymKey, type ProxyClient } from "../src/core/index.ts";
import { fileSource } from "../src/platform/fileSource.ts";
import { runExtraction } from "./extraction.ts";
import { BrowserFileSystem } from "../src/platform/browserFileSystem.ts";
import { forgetWorkspace, recallWorkspace, rememberWorkspace } from "../src/platform/handleStore.ts";
import { openRememberedWorkspace } from "../src/platform/openWorkspace.ts";

/**
 * The proxy's side is tested against the real proxy elsewhere. Here it
 * confirms "ws-check", and writes its one-time identity value into the
 * registered folder, which is "mod-1" in the private file system.
 */
const proxy: ProxyClient = {
  createWorkspace: async () => ({ registration_id: "", path: "" }),
  registerWorkspace: async () => ({ registration_id: "", path: "" }),
  confirmWorkspace: async (id, options) => {
    if (id !== "ws-check") return { confirmed: false, path: null, reason: "unknown", tightened: [] };
    const result = { confirmed: true, path: "/Users/moderator/Feedbacker/workspaces/mod-1", reason: null, tightened: [] as string[] };
    if (!options?.challenge) return result;
    const registered = await (await navigator.storage.getDirectory()).getDirectoryHandle("mod-1");
    const value = crypto.randomUUID();
    const file = `challenge-${value.replaceAll("-", "")}.json`;
    await new BrowserFileSystem(registered).writeText(file, JSON.stringify({ challenge: value }));
    return { ...result, challenge: { file, value } };
  },
};

const checks: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => checks.push([name, ok, detail]);
const rejects = async (run: () => Promise<unknown>, message: string) => {
  try {
    await run();
    return false;
  } catch (err) {
    return String((err as Error).message).includes(message);
  }
};

async function step1() {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry("mod-1", { recursive: true }).catch(() => {});
  const handle = await root.getDirectoryHandle("mod-1", { create: true });
  const fs = new BrowserFileSystem(handle);
  // What the proxy writes when it creates a workspace.
  await fs.writeText("registration.json", JSON.stringify({ registration_id: "ws-check" }));
  await fs.writeText("workspace.json", JSON.stringify({ layout_version: 1, name: "mod-1", created_at: "2026-01-15T09:00:00.000Z", retention_days: 90, retention_source: "default" }));

  const ws = await openWorkspace(fs, proxy);
  check("opens a confirmed workspace and shows its registered path", ws.registration.path.endsWith("/mod-1"));
  await ws.writeJson("marking/sub-001--marker.json", { kind: "original_assessment", note: "Zoë 🙂" });
  check("writes a record into a new subfolder and reads it back", JSON.stringify(await ws.readJson("marking/sub-001--marker.json")) === '{"kind":"original_assessment","note":"Zoë 🙂"}');
  check("writes exactly the Python core's JSON format", (await fs.readText("marking/sub-001--marker.json")) === '{\n  "kind": "original_assessment",\n  "note": "Zoë 🙂"\n}\n');
  check("sees files and folders", (await fs.exists("marking")) && (await fs.exists("marking/sub-001--marker.json")) && !(await fs.exists("nothing")));
  check("reads a missing file as absent", (await fs.readText("private/none.json")) === null);
  const listing = (await fs.list("")).map((e) => `${e.name}:${e.kind}`).join(",");
  check("lists the folder, with no identity check left behind", listing === "marking:directory,registration.json:file,workspace.json:file", listing);
  await ws.writeKey(PseudonymKey.parse({ entries: [{ submission_id: "sub-001", pseudonym: "[STUDENT_A]", external_id: "100200300" }] }));
  check("keeps the pseudonym key in private/", (await ws.readKey()).entries[0].external_id === "100200300");
  check("writes exports only into exports/", (await ws.writeExport("record", "json", "{}")) === "exports/record.feedbacker-export.json" && (await fs.exists("exports/record.feedbacker-export.json")));
  check("refuses paths that would leave the folder", await rejects(() => ws.writeJson("../escape.json", {}), "not a path inside the workspace"));
  check("refuses an unconfirmed folder", await rejects(async () => {
    const other = await root.getDirectoryHandle("other", { create: true });
    const otherFs = new BrowserFileSystem(other);
    await otherFs.writeText("registration.json", JSON.stringify({ registration_id: "ws-unknown" }));
    return openWorkspace(otherFs, proxy);
  }, "can't be opened: unknown"));
  await root.removeEntry("other", { recursive: true });
  check("refuses a copy of the registered folder, with the original still in place", await rejects(async () => {
    const copy = await root.getDirectoryHandle("copy", { create: true });
    const copyFs = new BrowserFileSystem(copy);
    for (const file of ["registration.json", "workspace.json"]) await copyFs.writeText(file, (await fs.readText(file))!);
    return openWorkspace(copyFs, proxy);
  }, "is not the registered workspace"));
  await root.removeEntry("copy", { recursive: true });
  for await (const name of handle.keys()) if (name.startsWith("challenge-")) await handle.removeEntry(name); // the copy's uncollected check
  await rememberWorkspace(handle);
  check("remembers only the folder handle", true);
}

async function step2() {
  const handle = await recallWorkspace();
  check("recalls the folder after a reload", handle !== null && handle.name === "mod-1");
  if (!handle) return;
  const ws = await openRememberedWorkspace(proxy);
  check("reopens the remembered folder, with read and write access", ws !== null && ws.registration.path.endsWith("/mod-1"));
  if (!ws) return;
  check("reads back through the recalled handle", (await ws.readKey()).entries[0].pseudonym === "[STUDENT_A]");
  check("won't delete without the name typed", await rejects(() => ws.delete("mod"), "type the workspace's name"));
  await ws.delete("mod-1");
  const root = await navigator.storage.getDirectory();
  const left: string[] = [];
  for await (const name of root.keys()) left.push(name);
  check("deletes the whole folder in one action", !left.includes("mod-1"), left.join(","));
  await forgetWorkspace();
  check("forgets the handle", (await recallWorkspace()) === null);
}

/** Step 3: extraction, inspection and selection in the browser, for the runner to compare with Node. */
async function step3() {
  const started = performance.now();
  const results = await runExtraction(async (name) => {
    const path = name === "sample.zip" ? "/zips/sample.zip" : `/pack/${name}`;
    const blob = await (await fetch(path)).blob();
    const file = new File([blob], name.split("/").at(-1)!);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), source: fileSource(file) };
  });
  Object.assign(window, { __extraction: results, __extractionMs: performance.now() - started });
}

const step = new URLSearchParams(location.search).get("step");
try {
  await (step === "3" ? step3() : step === "2" ? step2() : step1());
} catch (err) {
  check("no unexpected error", false, String(err));
}
Object.assign(window, { __result: checks });
document.getElementById("status")!.textContent = checks.every(([, ok]) => ok) ? "All checks passed." : "Some checks failed.";
