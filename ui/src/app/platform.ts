/**
 * What the app needs from its surroundings, passed in so the same app can be
 * checked in Chrome with the in-browser file system (automation can't use
 * the folder picker): the proxy, and opening a workspace folder.
 */

import type { ProxyClient, ProxyHealth, Workspace } from "../core/index.ts";

export interface AppProxy extends ProxyClient {
  health(): Promise<ProxyHealth>;
}

export interface Platform {
  /** Null when the app wasn't opened from the proxy's address (no session token). */
  proxy: AppProxy | null;
  /** Let the moderator choose the folder, then open it (from a click or key press). */
  openPicked(): Promise<Workspace>;
  /** Reopen the folder chosen last time, if the browser remembers one. */
  openRemembered(): Promise<Workspace | null>;
  /** Stop remembering the folder (the workspace itself is untouched). */
  forget(): Promise<void>;
}
