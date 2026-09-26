/**
 * The workspace folder in the browser: a File System Access API folder handle
 * (ADR 0004). The browser keeps only this handle, in IndexedDB, never any
 * records. Chromium browsers (Chrome, Edge) only.
 *
 * Writes go through `createWritable()`, which writes to a temporary file and
 * replaces the target when closed, so a record is never left half-written.
 */

import { segments, type Entry, type FileSystem } from "../core/fs.ts";

const isNotFound = (err: unknown) => err instanceof DOMException && (err.name === "NotFoundError" || err.name === "TypeMismatchError");

export class BrowserFileSystem implements FileSystem {
  readonly handle: FileSystemDirectoryHandle;

  constructor(handle: FileSystemDirectoryHandle) {
    this.handle = handle;
  }

  async #folder(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let dir = this.handle;
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part, { create });
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    }
    return dir;
  }

  async readText(path: string): Promise<string | null> {
    const parts = segments(path);
    const dir = await this.#folder(parts.slice(0, -1), false);
    if (!dir) return null;
    try {
      const file = await (await dir.getFileHandle(parts.at(-1)!)).getFile();
      return await file.text();
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async writeText(path: string, text: string): Promise<void> {
    const parts = segments(path);
    const dir = (await this.#folder(parts.slice(0, -1), true))!;
    const writable = await (await dir.getFileHandle(parts.at(-1)!, { create: true })).createWritable();
    try {
      await writable.write(text);
      await writable.close();
    } catch (err) {
      await writable.abort().catch(() => {});
      throw err;
    }
  }

  async exists(path: string): Promise<boolean> {
    const parts = segments(path);
    const dir = await this.#folder(parts.slice(0, -1), false);
    if (!dir) return false;
    for (const get of [() => dir.getFileHandle(parts.at(-1)!), () => dir.getDirectoryHandle(parts.at(-1)!)]) {
      try {
        await get();
        return true;
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    }
    return false;
  }

  async list(path: string): Promise<Entry[]> {
    const dir = path === "" ? this.handle : await this.#folder(segments(path), false);
    if (!dir) return [];
    const entries: Entry[] = [];
    for await (const [name, handle] of dir.entries()) entries.push({ name, kind: handle.kind });
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async remove(path: string): Promise<void> {
    const parts = segments(path);
    const dir = await this.#folder(parts.slice(0, -1), false);
    if (!dir) return;
    try {
      await dir.removeEntry(parts.at(-1)!);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  /**
   * Delete the folder itself, where the browser allows it (Chromium's
   * `FileSystemHandle.remove()`). Otherwise empty it and say so, because
   * the moderator must then remove the empty folder themselves.
   */
  async removeAll(): Promise<void> {
    const handle = this.handle as FileSystemDirectoryHandle & { remove?: (options: { recursive: boolean }) => Promise<void> };
    if (typeof handle.remove === "function") {
      await handle.remove({ recursive: true });
      return;
    }
    for await (const name of this.handle.keys()) await this.handle.removeEntry(name, { recursive: true });
    throw new Error("the workspace was emptied, but this browser can't delete the folder itself; delete the empty folder yourself");
  }
}

/** Ask for read and write access to a stored handle again (the browser asks the moderator). */
export async function ensureReadWrite(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?: (d: { mode: "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (d: { mode: "readwrite" }) => Promise<PermissionState>;
  };
  if (!h.queryPermission || !h.requestPermission) return true;
  if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return (await h.requestPermission({ mode: "readwrite" })) === "granted";
}

/** Let the moderator choose the workspace folder (needs a click or key press). */
export async function pickWorkspaceFolder(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as Window & { showDirectoryPicker?: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) throw new Error("this browser can't open folders; use Chrome or Edge");
  return picker({ id: "feedbacker-workspace", mode: "readwrite" });
}
