/**
 * The app in Chrome, under the proxy's Content Security Policy. The
 * workspaces folder is the origin private file system, and the proxy is a
 * stand-in (as in main.ts), because automation can't use the folder picker;
 * the proxy itself is tested against the real proxy elsewhere. The page
 * starts with two empty workspaces registered, a moderation and a marking,
 * which the check sets up through the app; choosing the workspaces folder
 * "picks" this one.
 */

import "../src/app/app.css";
import "../src/platform/pdfWorker.ts";
import { mount } from "svelte";
import { openWorkspace, WorkspaceError, type ListedWorkspace, type ProxyHealth, type ReadingRequest } from "../src/core/index.ts";
import { BrowserFileSystem } from "../src/platform/browserFileSystem.ts";
import App from "../src/app/App.svelte";
import type { AppProxy, Platform } from "../src/app/platform.ts";

const FOLDER = "app-ws";
const MARKING_FOLDER = "app-mark";
const WORKSPACES = "/Users/moderator/Feedbacker/workspaces";
const PATH = `${WORKSPACES}/app-check`;
const MARK_PATH = `${WORKSPACES}/mark-check`; // the marking workspace's
const FOLDER_ID = "wf-app-check";

/** The stand-in proxy's registry: each registration, with its folder in the private file system. */
const registry: { id: string; folder: string; path: string }[] = [
  { id: "ws-app", folder: FOLDER, path: PATH },
  { id: "ws-mark", folder: MARKING_FOLDER, path: MARK_PATH },
  { id: "ws-gone", folder: "gone", path: `${WORKSPACES}/gone` }, // registered, but its folder has gone
];
const folderOf = async (id: string) => {
  const r = registry.find((x) => x.id === id);
  return r ? (await navigator.storage.getDirectory()).getDirectoryHandle(r.folder) : null;
};

/** A stand-in reading, quoting the submission's first words: the first criterion's first level is suggested; the others have too little evidence. */
function standInReading(request: ReadingRequest) {
  const ids = [...request.blocks[0].text.matchAll(/^Criterion id: (.+)$/gm)].map((m) => m[1]);
  const firstLevel = /^- Level id: (\S+) \|/m.exec(request.blocks[0].text)?.[1] ?? null;
  const quote = [...request.blocks[2].text].slice(0, 30).join("");
  const criteria = ids.map((criterion_id, i) => ({
    criterion_id,
    suggested_level_id: i === 0 ? firstLevel : null,
    rationale: "A stand-in reading.",
    evidence: [quote],
    draft_comment: "Consider the brief.",
    missing_evidence: i !== 0,
  }));
  return { outcome: "complete", parsed: { criteria }, model_reported: request.model, request_id: "req_app", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0 }, raw_json: "{}", provider: "stand-in", request_sha256: "0".repeat(64), cost_usd: 0.001 };
}

let draftCalls = 0;

/** Stand-in drafts of feedback, for exactly what the marking block asks for. */
function standInDrafts(request: ReadingRequest) {
  const marking = request.blocks.at(-1)!.text;
  const ids = /Draft feedback for these criteria \(by id\): (.*)/.exec(marking)?.[1] ?? "none";
  draftCalls += 1; // each call's drafts differ, as a real AI's would
  const criteria = ids === "none" ? {} : Object.fromEntries(ids.split(", ").map((id) => [id, `You set this out clearly. Next time, go further (draft ${draftCalls}).`]));
  const overall = /Draft the overall summary: yes/.test(marking) ? "A clear piece of work. Next time, test more widely." : null;
  return { outcome: "complete", parsed: { criteria, overall }, model_reported: request.model, request_id: "req_draft", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0 }, raw_json: "{}", provider: "stand-in", request_sha256: "0".repeat(64), cost_usd: 0.001 };
}

/** A stand-in suggested edit: the flagged praise gone, the rest kept. */
function standInSuggestion(request: ReadingRequest) {
  return { outcome: "complete", parsed: { text: "Clear work. Next time, go further." }, model_reported: request.model, request_id: "req_edit", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0 }, raw_json: "{}", provider: "stand-in", request_sha256: "0".repeat(64), cost_usd: 0.001 };
}

/** A stand-in batch: it has ended by the second time it is checked. */
const batch = { requests: [] as ReadingRequest[], checks: 0, cancelled: false };
const batchProgress = () => {
  const n = batch.requests.length;
  const ended = batch.checks >= 2 || batch.cancelled;
  return {
    id: "msgbatch_app",
    status: ended ? "ended" : "in_progress",
    counts: { processing: ended ? 0 : n, succeeded: ended ? n : 0, errored: 0, canceled: 0, expired: 0 },
    created_at: "2026-09-28T09:00:00Z",
    expires_at: "2026-09-29T09:00:00Z",
    ended_at: ended ? "2026-09-28T09:05:00Z" : null,
  };
};

const proxy: AppProxy = {
  // ?health=fail: the proxy stops answering after the app has opened (to check the error screen).
  health: async (): Promise<ProxyHealth> => {
    if (new URLSearchParams(location.search).get("health") === "fail") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      throw new Error("the Feedbacker proxy could not be reached; is it running?");
    }
    return {
      key_configured: true,
      provider: "stand-in",
      batch: true,
      prices: { "claude-sonnet-5": { input: 2, output: 10, batch: 0.5 }, "claude-opus-5": { input: 5, output: 25, batch: 0.5 } },
    };
  },
  openRun: async () => ({ id: "run-app-check" }),
  read: async (_run, request) =>
    request.prompt.version.startsWith("feedback-edit-") ? standInSuggestion(request) : request.prompt.version.startsWith("feedback-") ? standInDrafts(request) : standInReading(request),
  sendBatch: async (_run, requests) => {
    Object.assign(batch, { requests, checks: 0, cancelled: false });
    return { ...batchProgress(), items: requests.map((_, i) => ({ custom_id: `r${i + 1}`, request_sha256: "0".repeat(64) })) };
  },
  batchStatus: async () => {
    batch.checks += 1;
    return batchProgress();
  },
  batchResults: async () => ({
    id: "msgbatch_app",
    items: batch.requests.map((request, i) => ({ custom_id: `r${i + 1}`, ...standInReading(request), request_id: `msg_r${i + 1}`, cost_usd: 0.0005 })),
  }),
  cancelBatch: async () => {
    batch.cancelled = true;
    return batchProgress();
  },
  createWorkspace: async () => ({ registration_id: "ws-app", path: PATH }),
  // As the proxy makes one by name: its folder, manifest and registration, in the workspaces folder.
  createNamedWorkspace: async (name, settings) => {
    const root = await navigator.storage.getDirectory();
    if (registry.some((r) => r.folder === name)) throw new WorkspaceError(`a workspace called '${name}' already exists; choose another name`);
    const fs = new BrowserFileSystem(await root.getDirectoryHandle(name, { create: true }));
    const id = `ws-${registry.length + 1}`;
    await fs.writeText("registration.json", JSON.stringify({ registration_id: id }));
    await fs.writeText("workspace.json", JSON.stringify({ layout_version: 1, name, created_at: "2026-10-07T09:00:00.000Z", ...settings }));
    registry.push({ id, folder: name, path: `${WORKSPACES}/${name}` });
    return { registration_id: id, path: `${WORKSPACES}/${name}` };
  },
  // From each registered folder's manifest, newest first, as the proxy lists them.
  listWorkspaces: async () => {
    const workspaces: ListedWorkspace[] = [];
    for (const r of registry) {
      const handle = await folderOf(r.id).catch(() => null);
      const text = handle ? await new BrowserFileSystem(handle).readText("workspace.json") : null;
      const m = text ? JSON.parse(text) : null;
      workspaces.push({
        registration_id: r.id,
        path: r.path,
        folder: r.folder,
        in_workspaces_folder: true,
        name: m?.name ?? null,
        workspace_type: m ? (m.workspace_type ?? "moderation") : null,
        created_at: m?.created_at ?? null,
        retention_days: m ? (m.retention_days ?? 90) : null,
        retention_source: m ? (m.retention_source ?? "default") : null,
        problem: m ? null : `the registered folder is no longer at ${r.path}`,
      });
    }
    return { folder: WORKSPACES, folder_id: FOLDER_ID, workspaces: workspaces.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")) };
  },
  registerWorkspace: async () => ({ registration_id: "ws-app", path: PATH }),
  // Recorded, so the check can see a deleted workspace's registration was forgotten.
  forgetWorkspace: async (id) => {
    Object.assign(window, { __forgotten: [...((window as unknown as { __forgotten?: string[] }).__forgotten ?? []), id] });
    const at = registry.findIndex((r) => r.id === id);
    if (at >= 0) registry.splice(at, 1);
    return { forgotten: at >= 0 };
  },
  confirmWorkspace: async (id, options) => {
    const registered = registry.find((r) => r.id === id);
    if (!registered) return { confirmed: false, path: null, reason: "unknown", tightened: [] };
    const result = { confirmed: true, path: registered.path, reason: null, tightened: [] as string[] };
    if (!options?.challenge) return result;
    const value = crypto.randomUUID();
    const file = `challenge-${value.replaceAll("-", "")}.json`;
    await new BrowserFileSystem((await folderOf(id))!).writeText(file, JSON.stringify({ challenge: value }));
    return { ...result, challenge: { file, value } };
  },
};

// A fresh, empty workspace, as the proxy creates one; the check then sets it up through the app.
const root = await navigator.storage.getDirectory();
for await (const name of root.keys()) await root.removeEntry(name, { recursive: true }); // nothing left from an earlier run
const fs = new BrowserFileSystem(await root.getDirectoryHandle(FOLDER, { create: true }));
await fs.writeText("registration.json", JSON.stringify({ registration_id: "ws-app" }));
await fs.writeText("workspace.json", JSON.stringify({ layout_version: 1, name: "app-check", created_at: "2026-09-27T09:00:00.000Z", retention_days: 90, retention_source: "default" }));
// And a fresh marking workspace beside it.
const markingFs = new BrowserFileSystem(await root.getDirectoryHandle(MARKING_FOLDER, { create: true }));
await markingFs.writeText("registration.json", JSON.stringify({ registration_id: "ws-mark" }));
await markingFs.writeText(
  "workspace.json",
  JSON.stringify({ layout_version: 1, name: "mark-check", workspace_type: "marking", created_at: "2026-10-04T09:00:00.000Z", retention_days: 90, retention_source: "default" }),
);

// The workspaces folder: its ID, as the proxy writes it; the browser's access to it starts as never chosen.
await new BrowserFileSystem(root).writeText("feedbacker-workspaces.json", JSON.stringify({ folder_id: FOLDER_ID }));
let access: "granted" | "prompt" | "none" = "none";
const platform: Platform = {
  proxy,
  folderAccess: async () => access,
  chooseFolder: async (folderId) => {
    Object.assign(window, { __chosen: ((window as unknown as { __chosen?: number }).__chosen ?? 0) + 1 }); // counted: only a press that needs the folder asks for it
    const text = await new BrowserFileSystem(root).readText("feedbacker-workspaces.json");
    if (!text || JSON.parse(text).folder_id !== folderId) throw new WorkspaceError("that isn't the Feedbacker workspaces folder");
    access = "granted";
  },
  allowFolder: async () => ((access = "granted"), "granted"),
  openElsewhereIfAllowed: async () => null,
  openInFolder: async (name) => openWorkspace(new BrowserFileSystem(await root.getDirectoryHandle(name)), proxy),
  openElsewhere: async () => {
    throw new WorkspaceError("not in this check");
  },
  forget: async () => {},
};
mount(App, { target: document.getElementById("app")!, props: { platform } });
Object.assign(window, { __appReady: true });
