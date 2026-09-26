/**
 * The workspace in a real browser (#46), on the origin private file system,
 * which gives the same folder handles as the folder picker without needing a
 * person to click. Step 1 opens and writes a workspace and remembers its
 * handle; step 2 (after a reload) recalls the handle, reads back, and deletes.
 */

import { openWorkspace, PseudonymKey, type ProxyClient } from "../src/core/index.ts";
import { BrowserFileSystem } from "../src/platform/browserFileSystem.ts";
import { forgetWorkspace, recallWorkspace, rememberWorkspace } from "../src/platform/handleStore.ts";

// The proxy's side is tested against the real proxy elsewhere; here it only confirms.
const proxy: ProxyClient = {
  createWorkspace: async () => ({ registration_id: "", path: "" }),
  registerWorkspace: async () => ({ registration_id: "", path: "" }),
  confirmWorkspace: async (id) => ({ confirmed: id === "ws-check", path: "/Users/moderator/Feedbacker/workspaces/mod-1", reason: "unknown", tightened: [] }),
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
  check("lists the folder", listing === "marking:directory,registration.json:file,workspace.json:file", listing);
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
  await rememberWorkspace(handle);
  check("remembers only the folder handle", true);
}

async function step2() {
  const handle = await recallWorkspace();
  check("recalls the folder after a reload", handle !== null && handle.name === "mod-1");
  if (!handle) return;
  const ws = await openWorkspace(new BrowserFileSystem(handle), proxy);
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

const step = new URLSearchParams(location.search).get("step");
try {
  await (step === "2" ? step2() : step1());
} catch (err) {
  check("no unexpected error", false, String(err));
}
Object.assign(window, { __result: checks });
document.getElementById("status")!.textContent = checks.every(([, ok]) => ok) ? "All checks passed." : "Some checks failed.";
