/**
 * The app in Chrome (#19), under the proxy's Content Security Policy. The
 * workspace is in the origin private file system and the proxy is a
 * stand-in (as in main.ts), because automation can't use the folder picker;
 * the proxy itself is tested against the real proxy elsewhere. The page
 * prepares a small moderation with the core, then mounts the real app.
 */

import "../src/app/app.css";
import { mount } from "svelte";
import { bytesSource, importRubric, openWorkspace, recordRequest, type ProxyHealth } from "../src/core/index.ts";
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
  health: async (): Promise<ProxyHealth> => ({ key_configured: false, provider: null, prices: {} }),
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

// A fresh workspace, as the proxy creates one, with a request and a rubric.
const root = await navigator.storage.getDirectory();
await root.removeEntry(FOLDER, { recursive: true }).catch(() => {});
const fs = new BrowserFileSystem(await folder());
await fs.writeText("registration.json", JSON.stringify({ registration_id: "ws-app" }));
await fs.writeText("workspace.json", JSON.stringify({ layout_version: 1, name: "app-check", created_at: "2026-09-27T09:00:00.000Z", retention_days: 90, retention_source: "default" }));
const ws = await openWorkspace(fs, proxy);
await recordRequest(ws, [{ external_id: "100200301", band: "60-69" }, { external_id: "100200302" }], { module: "Fictional Module 101", cohort_size: 40 });
await importRubric(ws, bytesSource("rubric.csv", new Uint8Array(await (await fetch("/pack/rubric.csv")).arrayBuffer())));

const platform: Platform = {
  proxy,
  openPicked: async () => openWorkspace(new BrowserFileSystem(await folder()), proxy),
  openRemembered: async () => null,
  forget: async () => {},
};
mount(App, { target: document.getElementById("app")!, props: { platform } });
Object.assign(window, { __appReady: true });
