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

/**
 * A folder read once and remembered: what has been read as text (and whether a path exists) is kept until it is written or removed through this, so the same record read
 * again on the next screen costs nothing. In a browser every read walks the folder handles and opens the file (several steps each), and the screens read every submission's
 * records, so without this a cohort of ninety is read in full each time anything changes. Only the Feedbacker app writes the folder while it is open, and always through this;
 * a change made by another program is seen when the page is loaded again. Big files are not kept, nor are binary ones.
 */
/** Other windows on the same folder: what a BroadcastChannel is. */
export interface Peers {
  postMessage(message: unknown): void;
  /** Call `handler` whenever another window says it changed something. */
  listen(handler: () => void): void;
}

export class CachingFileSystem implements FileSystem {
  readonly #inner: FileSystem;
  readonly #text = new Map<string, string | null>();
  readonly #exists = new Map<string, boolean>();
  static readonly LIMIT = 2_000_000;
  #epoch = 0; // bumped by every change: a read that began before one doesn't remember what it found (it may be the old value)

  /**
   * `peers` reaches other windows open on the same folder (a BroadcastChannel in the browser): each says when it has changed something, and the others forget
   * what they remembered, so a record edited in one window is read afresh in the other.
   */
  readonly #peers: Peers | null;

  constructor(inner: FileSystem, peers: Peers | null = null) {
    this.#inner = inner;
    this.#peers = peers;
    peers?.listen(() => this.forget());
  }

  /** Forget everything remembered (after something outside the app may have changed the folder). */
  forget(): void {
    this.#epoch += 1;
    this.#text.clear();
    this.#exists.clear();
  }

  async readText(path: string): Promise<string | null> {
    const key = segments(path).join("/");
    if (this.#text.has(key)) return this.#text.get(key)!;
    const epoch = this.#epoch;
    const text = await this.#inner.readText(path);
    if (epoch === this.#epoch && (text === null || text.length <= CachingFileSystem.LIMIT)) this.#text.set(key, text);
    return text;
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.#changed(path, () => this.#inner.writeText(path, text));
    if (text.length <= CachingFileSystem.LIMIT) this.#text.set(segments(path).join("/"), text);
  }

  readBytes(path: string): Promise<Uint8Array | null> {
    return this.#inner.readBytes(path);
  }

  writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    return this.#changed(path, () => this.#inner.writeBytes(path, bytes));
  }

  async exists(path: string): Promise<boolean> {
    const key = segments(path).join("/");
    const known = this.#exists.get(key);
    if (known !== undefined) return known;
    const epoch = this.#epoch;
    const found = await this.#inner.exists(path);
    if (epoch === this.#epoch) this.#exists.set(key, found);
    return found;
  }

  list(path: string): Promise<Entry[]> {
    return this.#inner.list(path);
  }

  remove(path: string): Promise<void> {
    return this.#changed(path, () => this.#inner.remove(path));
  }

  async removeAll(): Promise<void> {
    this.forget();
    await this.#inner.removeAll();
    this.forget();
  }

  /** Do the change, then forget what the path, and the folders above it, were remembered as. */
  async #changed(path: string, change: () => Promise<void>): Promise<void> {
    const parts = segments(path);
    // Forgotten before and after: a read that overlaps the change must not leave the old value remembered.
    const forget = () => {
      this.#epoch += 1;
      this.#text.delete(parts.join("/"));
      for (let i = 1; i <= parts.length; i++) this.#exists.delete(parts.slice(0, i).join("/"));
    };
    forget();
    try {
      await change();
    } finally {
      forget();
      this.#peers?.postMessage("changed"); // the other windows forget what they remember, even if the change failed part way
    }
  }
}

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
