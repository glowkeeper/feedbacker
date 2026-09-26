/**
 * Opening the workspace in the browser: pick the folder (or recall the one
 * picked before), make sure the browser has granted read and write access,
 * then open it through the proxy's checks.
 */

import { openWorkspace, WorkspaceError, type ProxyClient, type Workspace } from "../core/index.ts";
import { BrowserFileSystem, ensureReadWrite, pickWorkspaceFolder } from "./browserFileSystem.ts";
import { recallWorkspace, rememberWorkspace } from "./handleStore.ts";

async function open(handle: FileSystemDirectoryHandle, proxy: ProxyClient): Promise<Workspace> {
  if (!(await ensureReadWrite(handle))) {
    throw new WorkspaceError("Feedbacker needs permission to read and write the workspace folder");
  }
  const workspace = await openWorkspace(new BrowserFileSystem(handle), proxy);
  await rememberWorkspace(handle);
  return workspace;
}

/** Let the moderator choose the folder, then open it (call from a click or key press). */
export async function openPickedWorkspace(proxy: ProxyClient): Promise<Workspace> {
  return open(await pickWorkspaceFolder(), proxy);
}

/** Reopen the folder chosen last time, if there is one (the browser may ask for access again). */
export async function openRememberedWorkspace(proxy: ProxyClient): Promise<Workspace | null> {
  const handle = await recallWorkspace();
  return handle ? open(handle, proxy) : null;
}
