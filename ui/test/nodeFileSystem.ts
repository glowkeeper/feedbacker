/**
 * A FileSystem over a real folder, for tests. Like the browser, it writes
 * with the system's default permissions (typically 644 and 755), so tests
 * show the proxy restoring 600 and 700.
 */

import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Entry, FileSystem } from "../src/core/fs.ts";
import { segments } from "../src/core/fs.ts";

export class NodeFileSystem implements FileSystem {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  #path(path: string): string {
    return path === "" ? this.root : join(this.root, ...segments(path));
  }

  async readText(path: string): Promise<string | null> {
    try {
      return await readFile(this.#path(path), "utf8");
    } catch (err: any) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, new TextEncoder().encode(text));
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.#path(path)));
    } catch (err: any) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const target = this.#path(path);
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}`;
    await writeFile(tmp, bytes);
    await rename(tmp, target);
  }

  async exists(path: string): Promise<boolean> {
    return stat(this.#path(path)).then(() => true, () => false);
  }

  async list(path: string): Promise<Entry[]> {
    const entries = await readdir(this.#path(path), { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, kind: e.isDirectory() ? "directory" : "file" }));
  }

  async remove(path: string): Promise<void> {
    await unlink(this.#path(path)).catch((err) => {
      if (err.code !== "ENOENT") throw err;
    });
  }

  async removeAll(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }
}
