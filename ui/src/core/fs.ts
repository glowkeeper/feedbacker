/**
 * The workspace folder as the core sees it: relative, "/"-separated paths
 * inside one folder, and nothing outside it. The browser implementation wraps
 * a File System Access API folder handle (ui/src/platform/); the in-memory
 * one here serves tests and has no permissions to speak of.
 */

export interface Entry {
  name: string;
  kind: "file" | "directory";
}

export interface FileSystem {
  /** Null if the file doesn't exist. */
  readText(path: string): Promise<string | null>;
  /** Creates parent folders as needed and replaces the file in one step. */
  writeText(path: string, text: string): Promise<void>;
  /** As readText, for binary files such as stored originals. */
  readBytes(path: string): Promise<Uint8Array | null>;
  /** As writeText, for binary files. */
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<Entry[]>;
  /** Delete one file; nothing happens if it doesn't exist. */
  remove(path: string): Promise<void>;
  /** Delete the whole folder, contents and all. */
  removeAll(): Promise<void>;
}

/** Split a relative path into segments, refusing anything that could leave the folder. */
export function segments(path: string): string[] {
  const parts = path.split("/");
  if (!path || parts.some((p) => p === "" || p === "." || p === ".." || p.includes("\\"))) {
    throw new Error(`not a path inside the workspace: '${path}'`);
  }
  return parts;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class MemoryFileSystem implements FileSystem {
  readonly files = new Map<string, Uint8Array>();
  removed = false;

  constructor(files: Record<string, string | Uint8Array> = {}) {
    for (const [path, data] of Object.entries(files)) {
      this.files.set(segments(path).join("/"), typeof data === "string" ? encoder.encode(data) : data);
    }
  }

  #check(): void {
    if (this.removed) throw new Error("the workspace folder has been deleted");
  }

  async readText(path: string): Promise<string | null> {
    const bytes = await this.readBytes(path);
    return bytes === null ? null : decoder.decode(bytes);
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, encoder.encode(text));
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    this.#check();
    return this.files.get(segments(path).join("/"))?.slice() ?? null;
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    this.#check();
    this.files.set(segments(path).join("/"), bytes.slice());
  }

  async exists(path: string): Promise<boolean> {
    this.#check();
    const key = segments(path).join("/");
    return this.files.has(key) || [...this.files.keys()].some((k) => k.startsWith(`${key}/`));
  }

  async list(path: string): Promise<Entry[]> {
    this.#check();
    const prefix = path === "" ? "" : `${segments(path).join("/")}/`;
    const entries = new Map<string, Entry>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const [name, ...rest] = key.slice(prefix.length).split("/");
      entries.set(name, { name, kind: rest.length ? "directory" : "file" });
    }
    return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async remove(path: string): Promise<void> {
    this.#check();
    this.files.delete(segments(path).join("/"));
  }

  async removeAll(): Promise<void> {
    this.files.clear();
    this.removed = true;
  }
}
