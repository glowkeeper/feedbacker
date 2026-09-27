/**
 * The app in Chrome (#19), under the proxy's Content Security Policy. The
 * workspace is in the origin private file system and the proxy is a
 * stand-in (as in main.ts), because automation can't use the folder picker;
 * the proxy itself is tested against the real proxy elsewhere. The page
 * starts with an empty workspace, which the check sets up through the app.
 */

import "../src/app/app.css";
import "../src/platform/pdfWorker.ts";
import { mount } from "svelte";
import { openWorkspace, type ProxyHealth } from "../src/core/index.ts";
import { BrowserFileSystem } from "../src/platform/browserFileSystem.ts";
import App from "../src/app/App.svelte";
import type { AppProxy, Platform } from "../src/app/platform.ts";

const FOLDER = "app-ws";
const PATH = "/Users/moderator/Feedbacker/workspaces/app-check";

async function folder() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(FOLDER, { create: true });
}

const proxy: AppProxy = {
  // ?health=fail: the proxy stops answering after the app has opened (to check the error screen).
  health: async (): Promise<ProxyHealth> => {
    if (new URLSearchParams(location.search).get("health") === "fail") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      throw new Error("the Feedbacker proxy could not be reached; is it running?");
    }
    return { key_configured: true, provider: "stand-in", prices: { "claude-sonnet-5": { input: 2, output: 10 }, "claude-opus-5": { input: 5, output: 25 } } };
  },
  openRun: async () => ({ id: "run-app-check" }),
  // A stand-in reading: a level per criterion, quoting the submission's first words.
  read: async (_run, request) => {
    const ids = [...request.blocks[0].text.matchAll(/^Criterion id: (.+)$/gm)].map((m) => m[1]);
    const quote = [...request.blocks[2].text].slice(0, 30).join("");
    const criteria = ids.map((criterion_id) => ({ criterion_id, suggested_level_id: null, rationale: "A stand-in reading.", evidence: [quote], draft_comment: "Consider the brief.", missing_evidence: true }));
    return { outcome: "complete", parsed: { criteria }, model_reported: request.model, request_id: "req_app", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0 }, raw_json: "{}", provider: "stand-in", request_sha256: "0".repeat(64), cost_usd: 0.001 };
  },
  createWorkspace: async () => ({ registration_id: "ws-app", path: PATH }),
  registerWorkspace: async () => ({ registration_id: "ws-app", path: PATH }),
  confirmWorkspace: async (id, options) => {
    if (id !== "ws-app") return { confirmed: false, path: null, reason: "unknown", tightened: [] };
    const result = { confirmed: true, path: PATH, reason: null, tightened: [] as string[] };
    if (!options?.challenge) return result;
    const value = crypto.randomUUID();
    const file = `challenge-${value.replaceAll("-", "")}.json`;
    await new BrowserFileSystem(await folder()).writeText(file, JSON.stringify({ challenge: value }));
    return { ...result, challenge: { file, value } };
  },
};

// A fresh, empty workspace, as the proxy creates one; the check then sets it up through the app.
const root = await navigator.storage.getDirectory();
await root.removeEntry(FOLDER, { recursive: true }).catch(() => {});
const fs = new BrowserFileSystem(await folder());
await fs.writeText("registration.json", JSON.stringify({ registration_id: "ws-app" }));
await fs.writeText("workspace.json", JSON.stringify({ layout_version: 1, name: "app-check", created_at: "2026-09-27T09:00:00.000Z", retention_days: 90, retention_source: "default" }));

const platform: Platform = {
  proxy,
  openPicked: async () => openWorkspace(new BrowserFileSystem(await folder()), proxy),
  openRemembered: async () => null,
  forget: async () => {},
};
mount(App, { target: document.getElementById("app")!, props: { platform } });
Object.assign(window, { __appReady: true });
