/**
 * What the app needs from its surroundings, passed in so the same app can be
 * checked in Chrome with the in-browser file system (automation can't use
 * the folder picker): the proxy, and reaching and opening workspaces (ADR 0008).
 */

import type { ProxyClient, ReadingProxy, Workspace } from "../core/index.ts";
import type { MessageKind } from "./messages.ts";

/** The proxy, as the app uses it: workspaces, its health and prices, and the reading. */
export interface AppProxy extends ProxyClient, ReadingProxy {}

export interface Platform {
  /** Null when the app wasn't opened from the proxy's address (no session token). */
  proxy: AppProxy | null;
  /** Whether the proxy's workspaces folder (by its ID) can be reached: granted, remembered but needing a click for the browser to ask, or never chosen (or another folder). */
  folderAccess(folderId: string): Promise<"granted" | "prompt" | "none">;
  /** Let the educator choose the workspaces folder (from a click or key press); refused unless it holds the proxy's folder ID. */
  chooseFolder(folderId: string): Promise<void>;
  /** Ask the browser again for access to the remembered workspaces folder (from a click or key press). */
  allowFolder(folderId: string): Promise<"granted" | "refused" | "another folder">;
  /** Open a workspace inside the workspaces folder, by its folder's name. */
  openInFolder(folder: string): Promise<Workspace>;
  /** A workspace kept elsewhere, if its folder is remembered and already allowed (asks nothing); otherwise null. */
  openElsewhereIfAllowed(registrationId: string): Promise<Workspace | null>;
  /** Open a workspace kept elsewhere: its remembered folder, or one the educator chooses (from a click or key press). */
  openElsewhere(registrationId: string): Promise<Workspace>;
  /** Forget a deleted workspace's folder, if one was remembered (the workspaces folder is kept). */
  forget(registrationId: string): Promise<void>;
}

/** What happened to a workspace that is no longer open, told on the chooser (e.g. after deleting it). */
export interface Notice {
  message: string;
  kind: MessageKind;
}
