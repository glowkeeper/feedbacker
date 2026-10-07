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

const granted = async (handle: FileSystemDirectoryHandle) => {
  const h = handle as Permissioned;
  return !h.queryPermission || (await h.queryPermission({ mode: "readwrite" })) === "granted";
};

/**
 * Whether the proxy's workspaces folder can be reached now: granted, remembered but needing the browser to ask (a
 * click), or never chosen. A remembered folder that isn't this proxy's (it was started with another) counts as never
 * chosen, so the educator chooses again.
 */
export async function folderAccess(folderId: string): Promise<"granted" | "prompt" | "none"> {
  const handle = await recallFolder();
  if (!handle) return "none";
  if (!(await granted(handle))) return "prompt";
  return (await idIn(handle)) === folderId ? "granted" : "none";
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

/**
 * Ask the browser again for access to the remembered workspaces folder (call from a click or key press): granted, refused,
 * or granted but it isn't this proxy's folder (then the educator chooses the right one).
 */
export async function allowFolder(folderId: string): Promise<"granted" | "refused" | "another folder"> {
  const handle = await recallFolder();
  if (!handle || !(await ensureReadWrite(handle))) return "refused";
  return (await idIn(handle)) === folderId ? "granted" : "another folder";
}

/** Open a workspace inside the workspaces folder, by its folder's name. */
export async function openInFolder(folder: string, proxy: ProxyClient): Promise<Workspace> {
  const root = await recallFolder();
  if (!root || !(await granted(root))) throw new WorkspaceError("Feedbacker can't reach the workspaces folder yet");
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await root.getDirectoryHandle(folder);
  } catch {
    throw new WorkspaceError(`there is no folder called ${folder} in the workspaces folder`);
  }
  return openWorkspace(new BrowserFileSystem(handle), proxy);
}

const registrationIn = (handle: FileSystemDirectoryHandle) => fieldIn(handle, REGISTRATION, "registration_id");

/** A workspace kept elsewhere, only if its folder is remembered and the browser already allows it: nothing is asked. */
export async function openElsewhereIfAllowed(registrationId: string, proxy: ProxyClient): Promise<Workspace | null> {
  const handle = await recallElsewhere(registrationId);
  if (!handle || !(await granted(handle)) || (await registrationIn(handle)) !== registrationId) return null;
  return openWorkspace(new BrowserFileSystem(handle), proxy);
}

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
