/**
 * What the app needs from its surroundings, passed in so the same app can be
 * checked in Chrome with the in-browser file system (automation can't use
 * the folder picker): the proxy, and opening a workspace folder.
 */

import type { ProxyClient, ReadingProxy, Workspace } from "../core/index.ts";
import type { MessageKind } from "./messages.ts";

/** The proxy, as the app uses it: workspaces, its health and prices, and the reading. */
export interface AppProxy extends ProxyClient, ReadingProxy {}

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

/** What happened to a workspace that is no longer open, told on the chooser (e.g. after deleting it). */
export interface Notice {
  message: string;
  kind: MessageKind;
}
