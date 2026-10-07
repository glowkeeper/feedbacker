/**
 * Opening workspaces in the browser (ADR 0008). The workspaces folder is
 * chosen once, checked to be the proxy's (it holds the proxy's folder ID),
 * and remembered; each workspace inside it is then opened by its folder's
 * name, without a picker. A workspace kept elsewhere is opened by choosing
 * its folder, which is remembered too. Every workspace is still opened
 * through the proxy's checks, and must prove it is the registered folder.
 */

import { FOLDER_ID, openWorkspace, REGISTRATION, WorkspaceError, type ProxyClient, type Workspace } from "../core/index.ts";
import { BrowserFileSystem, ensureReadWrite, pickWorkspaceFolder } from "./browserFileSystem.ts";
import { recallElsewhere, recallFolder, rememberElsewhere, rememberFolder } from "./handleStore.ts";

type Permissioned = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: "readwrite" }) => Promise<PermissionState>;
};

/** Whether the workspaces folder can be reached now: granted, remembered but needing the browser to ask (a click), or never chosen. */
export async function folderAccess(): Promise<"granted" | "prompt" | "none"> {
  const handle = (await recallFolder()) as Permissioned | null;
  if (!handle) return "none";
  if (!handle.queryPermission) return "granted";
  return (await handle.queryPermission({ mode: "readwrite" })) === "granted" ? "granted" : "prompt";
}

/** A string field of a small JSON file in a folder, or null if it isn't there or can't be read. */
async function fieldIn(handle: FileSystemDirectoryHandle, file: string, field: string): Promise<string | null> {
  try {
    const text = await new BrowserFileSystem(handle).readText(file);
    const value = text === null ? null : (JSON.parse(text) as Record<string, unknown>)[field];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

const idIn = (handle: FileSystemDirectoryHandle) => fieldIn(handle, FOLDER_ID, "folder_id");

/** Let the educator choose the workspaces folder (call from a click or key press), and keep it only if it is the proxy's. */
export async function chooseFolder(folderId: string): Promise<void> {
  const handle = await pickWorkspaceFolder();
  if (!(await ensureReadWrite(handle))) throw new WorkspaceError("Feedbacker needs permission to read and write the workspaces folder");
  if ((await idIn(handle)) !== folderId) throw new WorkspaceError("that isn't the Feedbacker workspaces folder");
  await rememberFolder(handle);
}

/** Ask the browser again for access to the remembered workspaces folder (call from a click or key press). */
export async function allowFolder(): Promise<boolean> {
  const handle = await recallFolder();
  return handle ? ensureReadWrite(handle) : false;
}

/** Open a workspace inside the workspaces folder, by its folder's name. */
export async function openInFolder(folder: string, proxy: ProxyClient): Promise<Workspace> {
  const root = await recallFolder();
  if (!root || (await folderAccess()) !== "granted") throw new WorkspaceError("Feedbacker can't reach the workspaces folder yet");
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await root.getDirectoryHandle(folder);
  } catch {
    throw new WorkspaceError(`there is no folder called ${folder} in the workspaces folder`);
  }
  return openWorkspace(new BrowserFileSystem(handle), proxy);
}

const registrationIn = (handle: FileSystemDirectoryHandle) => fieldIn(handle, REGISTRATION, "registration_id");

/**
 * Open a workspace kept outside the workspaces folder: its remembered folder if the browser still allows it, or else
 * one the educator chooses (so call from a click or key press). The folder must hold this workspace's registration.
 */
export async function openElsewhere(registrationId: string, proxy: ProxyClient): Promise<Workspace> {
  let handle = await recallElsewhere(registrationId);
  if (!handle || !(await ensureReadWrite(handle)) || (await registrationIn(handle)) !== registrationId) {
    handle = await pickWorkspaceFolder();
    if (!(await ensureReadWrite(handle))) throw new WorkspaceError("Feedbacker needs permission to read and write the workspace folder");
    if ((await registrationIn(handle)) !== registrationId) throw new WorkspaceError("that folder isn't this workspace");
  }
  const workspace = await openWorkspace(new BrowserFileSystem(handle), proxy);
  await rememberElsewhere(registrationId, handle);
  return workspace;
}
