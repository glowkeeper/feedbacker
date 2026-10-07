/** The Feedbacker app, served by the local proxy. */

import "./app.css";
import { mount } from "svelte";
import { HttpProxyClient } from "../core/index.ts";
import { forgetWorkspace } from "../platform/handleStore.ts";
import { allowFolder, chooseFolder, folderAccess, openElsewhere, openInFolder } from "../platform/openWorkspace.ts";
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
  folderAccess,
  chooseFolder,
  allowFolder,
  openInFolder: (folder) => openInFolder(folder, proxy!),
  openElsewhere: (registrationId) => openElsewhere(registrationId, proxy!),
  forget: forgetWorkspace,
};

mount(App, { target: document.getElementById("app")!, props: { platform } });
