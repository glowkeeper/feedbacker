/** The Feedbacker app, served by the local proxy (#19). */

import "./app.css";
import { mount } from "svelte";
import { HttpProxyClient } from "../core/index.ts";
import { forgetWorkspace } from "../platform/handleStore.ts";
import { openPickedWorkspace, openRememberedWorkspace } from "../platform/openWorkspace.ts";
import "../platform/pdfWorker.ts";
import App from "./App.svelte";
import { takeToken } from "./connection.ts";
import type { Platform } from "./platform.ts";

let storage: Storage | null = null;
try {
  storage = window.sessionStorage;
} catch {
  // unavailable: the token lasts until reload
}
const token = takeToken(window.location, window.history, storage);
const proxy = token ? new HttpProxyClient(token) : null;

const platform: Platform = {
  proxy,
  openPicked: () => openPickedWorkspace(proxy!),
  openRemembered: () => openRememberedWorkspace(proxy!),
  forget: forgetWorkspace,
};

mount(App, { target: document.getElementById("app")!, props: { platform } });
